'use client';

import { useEffect, useState } from 'react';

type RequestState<T> = { status: 'idle' | 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; code: number };

export function useMarketRequest<T>(url: string | null, parse: (data: unknown) => T, timeoutMs = 10_000) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ key: string; state: RequestState<T> } | null>(null);
  const key = `${attempt}:${url ?? ''}`;
  useEffect(() => {
    const requestUrl = url;
    if (!requestUrl) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    let current = true;
    async function load(requestUrl: string) {
      try {
        const response = await fetch(requestUrl, { signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit' });
        const state: RequestState<T> = response.ok
          ? { status: 'ready', value: parse(await response.json()) }
          : { status: 'error', code: response.status };
        if (current) setSettled({ key, state });
      } catch {
        if (current) setSettled({ key, state: { status: 'error', code: 503 } });
      } finally {
        window.clearTimeout(timeout);
      }
    }
    void load(requestUrl);
    return () => {
      current = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [key, parse, timeoutMs, url]);
  const state: RequestState<T> = !url ? { status: 'idle' }
    : settled?.key === key ? settled.state : { status: 'loading' };
  return { state, retry: () => setAttempt(value => value + 1) };
}
