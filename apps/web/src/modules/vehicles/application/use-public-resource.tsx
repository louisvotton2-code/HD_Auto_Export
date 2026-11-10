'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { retryAfterSeconds } from '@/shared/lib/retry-after';
import {
  publicNavigationVersion,
  subscribePublicNavigation,
} from '@/shared/lib/public-navigation-events';

export type PublicFreshness = 'fresh' | 'checking' | 'error';
const FreshnessContext = createContext<PublicFreshness>('fresh');
export const usePublicFreshness = () => useContext(FreshnessContext);
export function PublicFreshnessBoundary({
  phase,
  url,
  children,
}: {
  phase: PublicFreshness;
  url: string;
  children: ReactNode;
}) {
  return (
    <FreshnessContext value={phase}>
      <div style={{ display: 'contents' }} data-freshness={phase} data-resource-url={url}>
        {children}
      </div>
    </FreshnessContext>
  );
}

/** SSR supplies the first body. Explicit queries/history/retries replace this resource; activation never fetches. */
export function usePublicResource<T>(
  url: string,
  initial: T | null,
  schema: { parse(value: unknown): T },
  {
    navigationPath,
    initialRetryAfter = 0,
    cooldown,
  }: {
    navigationPath?: string;
    initialRetryAfter?: number;
    cooldown?: { current: number };
  } = {},
) {
  const navigation = useSyncExternalStore(
    subscribePublicNavigation,
    () => (navigationPath ? publicNavigationVersion(navigationPath) : 0),
    () => 0,
  );
  const [state, setState] = useState<{
    url: string;
    data: T | null;
    phase: PublicFreshness;
    missing: boolean;
    navigation: number;
  }>({ url, data: initial, phase: initial ? 'fresh' : 'error', missing: false, navigation: 0 });
  const active = useRef({ url, schema, navigationPath });
  active.current = { url, schema, navigationPath };
  const request = useRef<{
    id: number;
    controller?: AbortController;
    url?: string;
    navigation?: number;
  }>({ id: 0 });
  const initialRef = useRef(initial);
  const initialRateRef = useRef(initialRetryAfter);
  const localRetryAt = useRef(initialRetryAfter > 0 ? Date.now() + initialRetryAfter * 1000 : 0);
  const retryAt = cooldown ?? localRetryAt;
  const [retryTick, setRetryAfter] = useState(initialRetryAfter);
  const retryAfter = Math.max(
    retryTick,
    Math.max(0, Math.ceil((retryAt.current - Date.now()) / 1000)),
  );
  const load = useCallback(async () => {
    const target = active.current.url;
    const checkedNavigation = active.current.navigationPath
      ? publicNavigationVersion(active.current.navigationPath)
      : 0;
    const remaining = Math.max(0, Math.ceil((retryAt.current - Date.now()) / 1000));
    if (remaining > 0) {
      setRetryAfter(remaining);
      setState((previous) => ({
        ...previous,
        url: target,
        phase: 'error',
        navigation: checkedNavigation,
      }));
      return;
    }
    if (
      request.current.url === target &&
      request.current.navigation === checkedNavigation &&
      request.current.controller &&
      !request.current.controller.signal.aborted
    )
      return;
    request.current.controller?.abort();
    const controller = new AbortController();
    const id = ++request.current.id;
    request.current.controller = controller;
    request.current.url = target;
    request.current.navigation = checkedNavigation;
    setState((previous) => ({ ...previous, phase: 'checking', missing: false }));
    try {
      const response = await fetch(target, {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
        headers: { Accept: 'application/json' },
      });
      if (response.status === 429) {
        await response.body?.cancel();
        if (id !== request.current.id) return;
        const seconds = retryAfterSeconds(response.headers.get('retry-after'));
        retryAt.current = Math.max(retryAt.current, Date.now() + seconds * 1000);
        setRetryAfter(seconds);
        setState((previous) => ({
          ...previous,
          url: target,
          phase: 'error',
          missing: false,
          navigation: checkedNavigation,
        }));
        return;
      }
      if (response.status === 404) {
        if (id === request.current.id)
          setState({
            url: target,
            data: null,
            phase: 'fresh',
            missing: true,
            navigation: checkedNavigation,
          });
        return;
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
        throw new Error('Public resource unavailable');
      const next = active.current.schema.parse(await response.json());
      if (id === request.current.id) {
        if (!cooldown) retryAt.current = 0;
        setRetryAfter(Math.max(0, Math.ceil((retryAt.current - Date.now()) / 1000)));
        setState({
          url: target,
          data: next,
          phase: 'fresh',
          missing: false,
          navigation: checkedNavigation,
        });
      }
    } catch {
      if (controller.signal.aborted || id !== request.current.id) return;
      setState((previous) => ({
        ...previous,
        url: target,
        phase: 'error',
        missing: false,
        navigation: checkedNavigation,
      }));
    } finally {
      if (id === request.current.id) request.current.controller = undefined;
    }
  }, []);
  const waiting = retryAfter > 0;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(
      () => setRetryAfter(Math.max(0, Math.ceil((retryAt.current - Date.now()) / 1000))),
      250,
    );
    return () => clearInterval(timer);
  }, [waiting]);
  useEffect(() => {
    if (state.url !== url) void load();
  }, [url, load, state.url]);
  useEffect(() => {
    if (initial !== initialRef.current || initialRetryAfter !== initialRateRef.current) {
      initialRef.current = initial;
      initialRateRef.current = initialRetryAfter;
      request.current.controller?.abort();
      request.current.id++;
      if (initialRetryAfter > 0)
        retryAt.current = Math.max(retryAt.current, Date.now() + initialRetryAfter * 1000);
      else if (!cooldown) retryAt.current = 0;
      setRetryAfter(
        Math.max(initialRetryAfter, Math.max(0, Math.ceil((retryAt.current - Date.now()) / 1000))),
      );
      setState({
        url,
        data: initial,
        phase: initial ? 'fresh' : 'error',
        missing: false,
        navigation: navigationPath ? publicNavigationVersion(navigationPath) : 0,
      });
    }
  }, [initial, url, initialRetryAfter]);
  useEffect(
    () =>
      subscribePublicNavigation((signal) => {
        if (active.current.navigationPath === signal.path && signal.ready) void load();
      }),
    [load],
  );
  useEffect(
    () => () => {
      request.current.controller?.abort();
      request.current.id++;
    },
    [],
  );
  return {
    ...state,
    // A rate limit on another request does not invalidate an already loaded dictionary.
    dataCurrent: state.url === url && state.phase === 'fresh',
    retryAfter,
    phase: waiting
      ? ('error' as PublicFreshness)
      : state.url === url && state.navigation >= navigation
        ? state.phase
        : ('checking' as PublicFreshness),
    reload: load,
  };
}
