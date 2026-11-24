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
  url: string | null;
  children: ReactNode;
}) {
  return (
    <FreshnessContext value={phase}>
      <div style={{ display: 'contents' }} data-freshness={phase} data-resource-url={url ?? undefined}>
        {children}
      </div>
    </FreshnessContext>
  );
}

/** SSR supplies the first body. Explicit queries/history/retries replace this resource; activation never fetches. */
export function usePublicResource<T>(
  url: string | null,
  initial: T | null,
  schema: { parse(value: unknown): T },
  {
    navigationPath,
    navigationSearch,
    initialRetryAfter = 0,
    cooldown,
    loadOnMount = false,
    compatibilityUrl,
  }: {
    navigationPath?: string;
    navigationSearch?: string;
    initialRetryAfter?: number;
    cooldown?: { current: number };
    loadOnMount?: boolean;
    compatibilityUrl?: string;
  } = {},
) {
  const navigation = useSyncExternalStore(
    subscribePublicNavigation,
    () => (navigationPath ? publicNavigationVersion(navigationPath) : 0),
    () => 0,
  );
  const [state, setState] = useState<{
    url: string | null;
    data: T | null;
    phase: PublicFreshness;
    missing: boolean;
    navigation: number;
  }>({ url: loadOnMount && !initial ? null : url, data: initial, phase: initial ? 'fresh' : 'error', missing: false, navigation: 0 });
  const [loadingUrl, setLoadingUrl] = useState<string | null>(null);
  const active = useRef({ url, schema, navigationPath, navigationSearch, compatibilityUrl });
  active.current = { url, schema, navigationPath, navigationSearch, compatibilityUrl };
  const request = useRef<{
    id: number;
    controller?: AbortController;
    url?: string;
    navigation?: number;
  }>({ id: 0 });
  const initialRef = useRef(initial);
  const initialRateRef = useRef(initialRetryAfter);
  const initialLoadRef = useRef(loadOnMount);
  const localRetryAt = useRef(initialRetryAfter > 0 ? Date.now() + initialRetryAfter * 1000 : 0);
  const retryAt = cooldown ?? localRetryAt;
  const [retryTick, setRetryAfter] = useState(initialRetryAfter);
  const retryAfter = Math.max(
    retryTick,
    Math.max(0, Math.ceil((retryAt.current - Date.now()) / 1000)),
  );
  const load = useCallback(async () => {
    const target = active.current.url;
    if (target === null) return;
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
    const isCurrent = () => id === request.current.id && active.current.url === target;
    // Preserve the last settled result while a different selection is pending.
    setLoadingUrl(target);
    try {
      const fallback = active.current.compatibilityUrl;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
      const read = (resourceUrl: string) => fetch(resourceUrl, {
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal,
        headers: { Accept: 'application/json' },
      });
      let response = await read(target);
      if (response.status === 400 && fallback && isCurrent()) {
        await response.body?.cancel();
        response = await read(fallback);
      }
      if (response.status === 429) {
        await response.body?.cancel();
        if (!isCurrent()) return;
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
        if (isCurrent())
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
      if (isCurrent()) {
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
      if (controller.signal.aborted || !isCurrent()) return;
      setState((previous) => ({
        ...previous,
        url: target,
        phase: 'error',
        missing: false,
        navigation: checkedNavigation,
      }));
    } finally {
      if (id === request.current.id) {
        request.current.controller = undefined;
        setLoadingUrl(null);
      }
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
    if (request.current.controller && request.current.url !== url) {
      request.current.controller?.abort();
      request.current = { id: request.current.id + 1 };
      setLoadingUrl(null);
    }
    if (state.url === url) return;
    // Keep the last payload for local options, but revalidate if the same URL is enabled again.
    if (url === null) setState(previous => ({ ...previous, url: null }));
    else void load();
  }, [url, load, state.url]);
  useEffect(() => {
    if (initial !== initialRef.current || initialRetryAfter !== initialRateRef.current || loadOnMount !== initialLoadRef.current) {
      initialRef.current = initial;
      initialRateRef.current = initialRetryAfter;
      initialLoadRef.current = loadOnMount;
      request.current.controller?.abort();
      request.current.id++;
      setLoadingUrl(null);
      if (initialRetryAfter > 0)
        retryAt.current = Math.max(retryAt.current, Date.now() + initialRetryAfter * 1000);
      else if (!cooldown) retryAt.current = 0;
      setRetryAfter(
        Math.max(initialRetryAfter, Math.max(0, Math.ceil((retryAt.current - Date.now()) / 1000))),
      );
      setState({
        url: loadOnMount && !initial ? null : url,
        data: initial,
        phase: initial ? 'fresh' : 'error',
        missing: false,
        navigation: navigationPath ? publicNavigationVersion(navigationPath) : 0,
      });
    }
  }, [initial, url, initialRetryAfter, loadOnMount]);
  useEffect(
    () =>
      subscribePublicNavigation((signal) => {
        if (!signal.ready || active.current.navigationPath !== signal.path) return;
        // popstate can arrive before Next commits the new search params. The URL-change effect loads that entry.
        const search = active.current.navigationSearch;
        if (search === undefined || (search === signal.search && search === new URLSearchParams(location.search).toString()))
          void load();
      }),
    [load, navigationSearch],
  );
  useEffect(
    () => () => {
      request.current.controller?.abort();
      request.current.id++;
    },
    [],
  );
  const markMissing = useCallback(() => {
    request.current.id++;
    request.current.controller?.abort();
    request.current.controller = undefined;
    setLoadingUrl(null);
    setState({ url: active.current.url, data: null, phase: 'fresh', missing: true,
      navigation: active.current.navigationPath ? publicNavigationVersion(active.current.navigationPath) : 0 });
  }, []);
  const checking = url !== null && loadingUrl === url;
  return {
    ...state,
    missing: state.url === url && !checking && state.missing,
    // A rate limit on another request does not invalidate an already loaded dictionary.
    dataCurrent: url !== null && state.url === url && !checking && state.phase === 'fresh',
    retryAfter,
    phase: waiting
      ? ('error' as PublicFreshness)
      : !checking && state.url === url && state.navigation >= navigation
        ? state.phase
        : ('checking' as PublicFreshness),
    reload: load,
    markMissing,
  };
}
