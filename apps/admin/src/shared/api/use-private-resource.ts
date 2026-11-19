import { useEffect, useState } from 'react';
import { ApiClientError, request, requestWithTimeout } from './client';

export function usePrivateResource<T>(path: string | null, schema: { parse(value: unknown): T }, revision = 0, timeoutMs?: number) {
  const key = JSON.stringify([path, revision]);
  const [state, setState] = useState<{ key: string; data?: T; error?: string; errorStatus?: number }>({ key: '' });
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (expired || !path) return;
    const controller = new AbortController();
    let active = true;
    const unauthorized = () => {
      active = false;
      controller.abort();
      setState({ key: '' });
      setExpired(true);
    };
    window.addEventListener('admin:unauthorized', unauthorized);
    const options = { signal: controller.signal };
    const pending = timeoutMs === undefined ? request(path, schema, options) : requestWithTimeout(path, schema, timeoutMs, options);
    pending
      .then(response => { if (active) setState({ key, data: response }); })
      .catch(error => {
        if (active && !controller.signal.aborted) setState({ key,
          error: error instanceof Error ? error.message : '私有资料读取失败',
          errorStatus: error instanceof ApiClientError ? error.status : undefined,
        });
      });
    return () => { active = false; controller.abort(); window.removeEventListener('admin:unauthorized', unauthorized); };
  }, [key, path, expired, schema, timeoutMs]);
  return {
    data: !expired && state.key === key ? state.data : undefined,
    error: expired ? '登录已失效，重新登录后请重新读取。' : state.key === key ? state.error : undefined,
    errorStatus: expired ? 401 : state.key === key ? state.errorStatus : undefined,
    loading: !!path && !expired && (state.key !== key || (!state.data && !state.error)),
    resume: () => setExpired(false),
  };
}
