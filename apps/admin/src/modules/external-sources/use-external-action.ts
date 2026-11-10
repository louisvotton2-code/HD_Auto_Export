import { useEffect, useRef, useState } from 'react';
import { ApiClientError, request } from '../../shared/api/client';
import { useExternalGuard } from './external-workspace';

type Intent<T> = { key: string; path: string; body: string; created: number; matches?: (response: T) => boolean };

export function useExternalAction<T>(method: 'POST' | 'PUT', schema: { parse(data: unknown): T }) {
  const intent = useRef<Intent<T> | undefined>(undefined);
  const active = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  useExternalGuard(busy || uncertain);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function execute(input?: { path: string; body: string; matches?: (response: T) => boolean }): Promise<T | undefined> {
    if (active.current || (input && intent.current)) return;
    if (input) intent.current = {
      path: input.path, key: crypto.randomUUID(), body: input.body, created: Date.now(), matches: input.matches,
    };
    const attempt = intent.current;
    if (!attempt) return;
    if (Date.now() - attempt.created >= 24 * 60 * 60 * 1000) {
      setError('原请求已超过幂等保留期，请核对服务端记录。');
      return;
    }
    active.current = true;
    setBusy(true);
    setError('');
    setErrorCode('');
    try {
      const response = await request(attempt.path, schema, {
        method, body: attempt.body, headers: { 'Idempotency-Key': attempt.key }, signal: AbortSignal.timeout(35_000),
      });
      if (!mounted.current) return;
      if (attempt.matches && !attempt.matches(response)) throw new ApiClientError(0, 'INVALID_RESPONSE');
      intent.current = undefined;
      setUncertain(false);
      return response;
    } catch (failure) {
      if (!mounted.current) return;
      const knownRejection = failure instanceof ApiClientError && [400, 401, 403, 404, 409, 413, 422, 429].includes(failure.status);
      setError(failure instanceof Error ? failure.message : '操作结果尚未确认。');
      setErrorCode(failure instanceof ApiClientError ? failure.code : '');
      if (uncertain || !knownRejection) setUncertain(true);
      else intent.current = undefined;
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  function clear() {
    if (active.current) return;
    intent.current = undefined;
    setUncertain(false);
    setError('');
    setErrorCode('');
  }

  return { execute, clear, busy, uncertain, error, errorCode };
}
