'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { PublicVehicleSegmentQuerySchema, type PublicVehicle } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { retryAfterSeconds } from '@/shared/lib/retry-after';
import { usePublicFreshness } from './use-public-resource';
import { parseVehicleSegment, mergeVehicleSegment, VehicleSegmentError, type VehicleSegmentKind, type VehicleSegmentPages } from '../public-segments';

export const VehicleSegmentContext = createContext<{ cooldown: MutableRefObject<number>; onMissing: () => void } | null>(null);
type Phase = 'idle' | 'loading' | 'ready' | 'error' | 'changed' | 'missing';

/** Public-only, explicit loading. Preview never consumes this hook or its public cursors. */
export function usePublicVehicleSegment<K extends VehicleSegmentKind>(kind: K, vehicle: PublicVehicle, locale: Locale) {
  const context = useContext(VehicleSegmentContext);
  const localCooldown = useRef(0);
  const cooldown = context?.cooldown ?? localCooldown;
  const fresh = usePublicFreshness() === 'fresh';
  const [state, setState] = useState<{ scope: PublicVehicle; locale: Locale; page: VehicleSegmentPages[K] | null; started: boolean; phase: Phase }>({ scope: vehicle, locale, page: null, started: false, phase: 'idle' });
  const [retryAfter, setRetryAfter] = useState(0);
  const active = useRef({ vehicle, locale, kind, fresh });
  active.current = { vehicle, locale, kind, fresh };
  const current = useRef(state);
  current.current = state;
  const request = useRef<{ id: number; controller?: AbortController }>({ id: 0 });
  const cursors = useRef(new Set<string>());
  const onMissing = useRef(context?.onMissing);
  onMissing.current = context?.onMissing;

  useEffect(() => {
    request.current.id++;
    request.current.controller?.abort();
    request.current.controller = undefined;
    cursors.current.clear();
    setState({ scope: vehicle, locale, page: null, started: false, phase: 'idle' });
  }, [vehicle, locale, kind]);
  useEffect(() => {
    if (fresh) return;
    request.current.id++;
    request.current.controller?.abort();
    request.current.controller = undefined;
    setState(previous => previous.phase === 'loading' ? { ...previous, phase: 'error' } : previous);
  }, [fresh]);
  useEffect(() => () => { request.current.id++; request.current.controller?.abort(); }, []);
  useEffect(() => {
    if (!retryAfter) return;
    const timer = setInterval(() => setRetryAfter(Math.max(0, Math.ceil((cooldown.current - Date.now()) / 1000))), 250);
    return () => clearInterval(timer);
  }, [retryAfter > 0, cooldown]);

  const load = useCallback(async (restart = false) => {
    const scope = active.current;
    if (!scope.fresh || request.current.controller) return;
    const wait = Math.max(0, Math.ceil((cooldown.current - Date.now()) / 1000));
    if (wait) { setRetryAfter(wait); return; }
    const before = current.current.scope === scope.vehicle && current.current.locale === scope.locale ? current.current : null;
    const previous = restart ? null : before?.page ?? null;
    if (!restart && before?.started && !previous?.nextCursor && before.phase === 'ready') return;
    const cursor = previous?.nextCursor ?? undefined;
    if (restart) cursors.current.clear();
    const controller = new AbortController();
    const id = ++request.current.id;
    request.current.controller = controller;
    if (restart) setState({ scope: scope.vehicle, locale: scope.locale, page: null, started: before?.started ?? false, phase: 'loading' });
    else setState(old => ({ ...old, phase: 'loading' }));
    const stillCurrent = () => id === request.current.id && active.current.vehicle === scope.vehicle
      && active.current.locale === scope.locale && active.current.fresh;
    try {
      const query = PublicVehicleSegmentQuerySchema.parse({ locale: scope.locale, limit: 50, cursor });
      const params = new URLSearchParams(Object.entries(query).filter(([,value]) => value !== undefined).map(([key,value]) => [key,String(value)]));
      const response = await fetch(`/api/v1/vehicles/${scope.vehicle.id}/${scope.kind}/?${params}`, {
        cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Accept: 'application/json' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new VehicleSegmentError(response.status, response.status === 429 ? retryAfterSeconds(response.headers.get('retry-after')) : 0);
      }
      if (!response.headers.get('content-type')?.includes('application/json')) throw new VehicleSegmentError(503);
      // The same-origin BFF bounds JSON bytes before this public schema is parsed.
      const data = parseVehicleSegment(scope.kind, await response.json(), scope.vehicle.id, scope.locale).data as VehicleSegmentPages[K];
      if (!stillCurrent()) return;
      if (data.nextCursor && (data.nextCursor === cursor || cursors.current.has(data.nextCursor))) throw new VehicleSegmentError(503);
      const page = mergeVehicleSegment(previous, data);
      if (cursor) cursors.current.add(cursor);
      setState({ scope: scope.vehicle, locale: scope.locale, page, started: true, phase: 'ready' });
    } catch (error) {
      if (controller.signal.aborted || !stillCurrent()) return;
      const status = error instanceof VehicleSegmentError ? error.status : 503;
      if (status === 429) {
        const seconds = (error as VehicleSegmentError).retryAfter;
        cooldown.current = Math.max(cooldown.current, Date.now() + seconds * 1000);
        setRetryAfter(seconds);
      }
      if (status === 409 || status === 404) {
        cursors.current.clear();
        setState({ scope: scope.vehicle, locale: scope.locale, page: null, started: true, phase: status === 404 ? 'missing' : 'changed' });
        if (status === 404) onMissing.current?.();
      } else setState(old => ({ ...old, phase: 'error' }));
    } finally { if (id === request.current.id) request.current.controller = undefined; }
  }, [cooldown]);
  const valid = state.scope === vehicle && state.locale === locale;
  const page = valid ? state.page : null;
  return {
    items: (page?.items ?? []) as VehicleSegmentPages[K]['items'],
    inspectionStatus: page && 'status' in page ? (page as VehicleSegmentPages['inspection']).status : null,
    total: page?.total ?? null, started: valid && state.started,
    phase: valid ? state.phase : 'idle' as Phase,
    hasMore: page ? page.nextCursor !== null : true,
    retryAfter: Math.max(retryAfter, Math.max(0, Math.ceil((cooldown.current - Date.now()) / 1000))),
    loadMore: () => { void load(); }, restart: () => { void load(true); },
  };
}
