import { createHmac, createSecretKey, type KeyObject } from 'node:crypto';
import { performance } from 'node:perf_hooks';

type Options = {
  now?: () => number;
  attempts?: number;
  windowMs?: number;
  maxAccounts?: number;
  maxNewAccounts?: number;
};

type Bucket = { count: number; expiresAt: number };
const retrySeconds = (expiresAt: number, now: number) => Math.ceil((expiresAt - now) / 1000);

/** Per-process login budget, independent of account existence and authentication results. */
export class LoginAccountLimiter {
  readonly #key: KeyObject;
  readonly #buckets = new Map<string, Bucket>();
  readonly #now: () => number;
  readonly #attempts: number;
  readonly #windowMs: number;
  readonly #maxLiveBuckets: number;

  constructor(authSecret: string, { now = () => performance.now(), attempts = 5, windowMs = 60_000,
    maxAccounts = 512, maxNewAccounts = 120 }: Options = {}) {
    if (![attempts, windowMs, maxAccounts, maxNewAccounts].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new Error('Invalid login account limit policy');
    }
    this.#key = createSecretKey(createHmac('sha256', authSecret).update('hd-auto:login-account-limit:v1').digest());
    this.#now = now;
    this.#attempts = attempts;
    this.#windowMs = windowMs;
    // Each bucket lives for one full window. The live bucket count is therefore
    // also the number of new buckets admitted in the trailing window.
    this.#maxLiveBuckets = Math.min(maxAccounts, maxNewAccounts);
  }

  retryAfter(email: unknown): number | null {
    if (typeof email !== 'string' || email.length === 0) return null;

    // Match the case normalization used by Better Auth after its validation.
    const id = createHmac('sha256', this.#key).update(email.toLowerCase()).digest('hex');
    const now = this.#now();
    const firstExpiry = this.#discardExpired(now);
    const bucket = this.#buckets.get(id);
    if (bucket) {
      if (bucket.count >= this.#attempts) return retrySeconds(bucket.expiresAt, now);
      bucket.count++;
      return null;
    }

    if (firstExpiry !== undefined && this.#buckets.size >= this.#maxLiveBuckets) {
      return retrySeconds(firstExpiry, now);
    }
    this.#buckets.set(id, { count: 1, expiresAt: now + this.#windowMs });
    return null;
  }

  #discardExpired(now: number): number | undefined {
    // Expiry order follows insertion order with the monotonic clock. An
    // admitted attempt never extends a bucket or displaces another account.
    for (const [id, bucket] of this.#buckets) {
      if (bucket.expiresAt > now) return bucket.expiresAt;
      this.#buckets.delete(id);
    }
  }
}
