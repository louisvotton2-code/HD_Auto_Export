import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError, notFound } from '../errors.js';

export const salesVehiclesPath = '/api/v1/integrations/sales/vehicles';
export const salesVehicleLookupPath = `${salesVehiclesPath}/lookup`;

const activeLimit = 2;
const waitingLimit = 24;
type WaitingRead = {
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  enter: () => void;
  expire: () => void;
};

function busy(reply: FastifyReply, message: string) {
  reply.header('Retry-After', '1');
  return new ApiError(429, 'RATE_LIMITED', message, undefined, true);
}

/** Both routes and both rotation credentials share a fixed budget before any database access. */
export function salesAccess(tokens: readonly string[], now = () => performance.now(), waitLimitMs = 2000) {
  const credentials = tokens.map(token => Buffer.from(token, 'hex'));
  let windowStart = now();
  let requests = 0;
  let active = 0;
  const waiting: WaitingRead[] = [];
  const waitExpired = (reply: FastifyReply) => busy(reply, 'Sales service wait expired.');

  function reserve(reply: FastifyReply, expiresAt: number) {
    return new Promise<void>((enter, reject) => {
      const expire = () => reject(waitExpired(reply));
      const timer = setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index < 0) return;
        waiting.splice(index, 1);
        expire();
      }, Math.ceil(expiresAt - now()));
      const waiter = { expiresAt, timer, enter, expire };
      waiting.push(waiter);
    });
  }

  function release() {
    // Pass the slot directly to the oldest waiter so a new arrival cannot overtake it.
    while (waiting.length) {
      const waiter = waiting.shift()!;
      clearTimeout(waiter.timer);
      if (waiter.expiresAt > now()) {
        waiter.enter();
        return;
      }
      waiter.expire();
    }
    active--;
  }

  return {
    authenticate(request: FastifyRequest, reply: FastifyReply) {
      if (!credentials.length) throw notFound();
      const supplied = /^Bearer ([a-f0-9]{64})$/i.exec(request.headers.authorization ?? '')?.[1];
      const token = Buffer.from(supplied ?? '0'.repeat(64), 'hex');
      let matches = false;
      for (const expected of credentials) matches = timingSafeEqual(expected, token) || matches;
      if (!supplied || !matches) {
        reply.header('WWW-Authenticate', 'Bearer');
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sales service authentication is required.');
      }
      const elapsed = now() - windowStart;
      if (elapsed >= 60_000) {
        windowStart = now();
        requests = 0;
      }
      if (requests >= 60) {
        reply.header('Retry-After', String(Math.max(1, Math.ceil((60_000 - elapsed) / 1000))));
        throw new ApiError(429, 'RATE_LIMITED', 'Sales service request rate exceeded.', undefined, true);
      }
      requests++;
    },
    async read<T>(reply: FastifyReply, work: () => Promise<T>): Promise<T> {
      let expiresAt: number | undefined;
      if (active >= activeLimit) {
        if (waiting.length >= waitingLimit) throw busy(reply, 'Sales service queue is full.');
        expiresAt = now() + waitLimitMs;
        await reserve(reply, expiresAt);
      } else {
        active++;
      }
      try {
        if (expiresAt !== undefined && expiresAt <= now()) throw waitExpired(reply);
        return await work();
      } finally {
        release();
      }
    },
  };
}
