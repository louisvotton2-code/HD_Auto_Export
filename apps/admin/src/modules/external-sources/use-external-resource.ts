import { useEffect, useState } from 'react';
import { request } from '../../shared/api/client';

type Resource<T> =
  | { path: string; revision: number; data: T; error?: never }
  | { path: string; revision: number; data?: never; error: string };

export function useExternalResource<T>(path: string, schema: { parse(data: unknown): T }) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Resource<T>>();
  const current = result?.path === path && result.revision === revision ? result : undefined;

  useEffect(() => {
    const controller = new AbortController();
    request(path, schema, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setResult({ path, revision, data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({
        path, revision, error: error instanceof Error ? error.message : '读取外部车源失败。',
      });
    });
    return () => controller.abort();
  }, [path, revision, schema]);

  return {
    data: current?.data,
    error: current?.error,
    loading: !current,
    reload: () => setRevision(value => value + 1),
  };
}
