import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConfirmPublicationPreviewRequestSchema, PublishReadinessResponseSchema,
  type ConfirmPublicationPreviewRequest, type PublishReadiness,
} from '@hd/contracts/admin';
import type { Locale } from '@hd/contracts/public';
import { ApiClientError, request } from '../../shared/api/client';

const confirmationLifetime = 10 * 60 * 1000;
function confirmationDeadline(ready: PublishReadiness) {
  if (!ready.confirmation) return 0;
  return Math.min(Date.parse(ready.confirmation.expiresAt), Date.parse(ready.confirmation.confirmedAt) + confirmationLifetime);
}
export function publicationConfirmationIsCurrent(ready: PublishReadiness, now = Date.now()) {
  return ready.previewConfirmed && ready.confirmation?.locale === ready.locale && confirmationDeadline(ready) > now;
}
export function publicationReceiptMatches(ready: PublishReadiness, receipt: ConfirmPublicationPreviewRequest | null) {
  return Boolean(receipt && receipt.version === ready.vehicleVersion && receipt.publicContentRevision === ready.publicContentRevision
    && receipt.fingerprint === ready.fingerprint && receipt.locale === ready.locale);
}
type Snapshot = {
  key: string; data: PublishReadiness | null; loading: boolean; confirming: boolean; error: string;
};
type Options = { vehicleId: string; version: number; locale: Locale; onConflict?: () => void };

/** Reads and acknowledges a server gate; this hook never approves text or publishes a vehicle. */
export function usePublicationReadiness(options: Options) {
  const key = JSON.stringify([options.vehicleId, options.version, options.locale]);
  const current = useRef({ ...options, key }); current.current = { ...options, key };
  const [snapshot, setSnapshot] = useState<Snapshot>({ key, data: null, loading: true, confirming: false, error: '' });
  const snapshotRef = useRef(snapshot);
  const alive = useRef(true);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const confirmationInFlight = useRef(false);
  const refreshPending = useRef(false);
  const refreshAfterConfirmation = useRef<() => void>(() => {});
  const lastExpiredRefresh = useRef('');
  const [, setClock] = useState(0);

  function update(value: Snapshot) { snapshotRef.current = value; if (alive.current) setSnapshot(value); }
  const run = useCallback(async (receipt?: ConfirmPublicationPreviewRequest): Promise<{ ok: boolean; error?: string }> => {
    const target = current.current;
    const confirming = receipt !== undefined;
    if (confirmationInFlight.current) {
      // A rendered receipt or visibility event may change while confirmation is in flight.
      // Keep that refresh, but do not abort a mutation whose result would become unknown.
      if (!confirming) refreshPending.current = true;
      return { ok: false, error: '正在确认当前预览，请等待结果。' };
    }
    if (confirming) {
      const ready = snapshotRef.current;
      if (!ConfirmPublicationPreviewRequestSchema.safeParse(receipt).success || ready.key !== target.key || ready.loading || ready.error || !ready.data
        || !ready.data.requiredFieldsReady || !ready.data.localizationReady || receipt.version !== target.version || !publicationReceiptMatches(ready.data, receipt)) {
        return { ok: false, error: '预览与当前已保存资料不一致，请重新读取发布检查和预览后确认。' };
      }
    }
    controller.current?.abort();
    const requestController = new AbortController(); controller.current = requestController;
    const token = ++sequence.current;
    confirmationInFlight.current = confirming;
    const previous = snapshotRef.current.key === target.key ? snapshotRef.current.data : null;
    update({ key: target.key, data: previous, loading: true, confirming, error: '' });
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; requestController.abort(); }, 15_000);
    try {
      const path = `/api/v1/admin/vehicles/${encodeURIComponent(target.vehicleId)}`;
      const response = await request(confirming ? `${path}/publication-preview/confirm` : `${path}/publish-readiness?locale=${target.locale}`,
        PublishReadinessResponseSchema, confirming
          ? { method: 'POST', body: JSON.stringify(receipt), signal: requestController.signal }
          : { signal: requestController.signal });
      if (!alive.current || token !== sequence.current || target.key !== current.current.key) return { ok: false };
      const ready = response.data;
      if (ready.vehicleId !== target.vehicleId || ready.vehicleVersion !== target.version) {
        update({ key: target.key, data: null, loading: false, confirming: false, error: '服务端车辆版本已变化，当前发布检查未采用。请核对最新车辆资料。' });
        current.current.onConflict?.();
        return { ok: false, error: '服务端车辆版本已变化，请核对最新车辆资料。' };
      }
      if (ready.locale !== target.locale || (ready.confirmation && ready.confirmation.locale !== target.locale)
        || (confirming && (!publicationReceiptMatches(ready, receipt) || !publicationConfirmationIsCurrent(ready)))) {
        throw new Error('服务端返回的预览确认与当前内容或语言不一致，请重新读取核对。');
      }
      update({ key: target.key, data: ready, loading: false, confirming: false, error: '' });
      return { ok: true };
    } catch (failure) {
      if (!alive.current || token !== sequence.current || target.key !== current.current.key) return { ok: false };
      const detail = timedOut ? '发布检查等待超时，请重新读取核对；没有自动确认或发布。'
        : failure instanceof Error ? failure.message : '发布检查未完成，请重新读取核对。';
      update({ key: target.key, data: previous, loading: false, confirming: false, error: detail });
      if (failure instanceof ApiClientError && failure.status === 409) current.current.onConflict?.();
      return { ok: false, error: detail };
    } finally {
      clearTimeout(timeout);
      if (token === sequence.current) {
        controller.current = null; confirmationInFlight.current = false;
        if (refreshPending.current) {
          refreshPending.current = false;
          queueMicrotask(() => { if (alive.current) refreshAfterConfirmation.current(); });
        }
      }
    }
  }, []);
  const reload = useCallback(() => run(), [run]);
  refreshAfterConfirmation.current = () => { void reload(); };

  useEffect(() => {
    alive.current = true;
    // A new vehicle/version/language invalidates old reads and old acknowledgements immediately.
    sequence.current += 1; controller.current?.abort(); confirmationInFlight.current = false;
    lastExpiredRefresh.current = ''; refreshPending.current = false;
    void reload();
    return () => { sequence.current += 1; controller.current?.abort(); confirmationInFlight.current = false; };
  }, [key, reload]);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') void reload(); };
    document.addEventListener('visibilitychange', visible);
    return () => document.removeEventListener('visibilitychange', visible);
  }, [reload]);
  const ready = snapshot.key === key ? snapshot.data : null;
  useEffect(() => {
    if (!ready?.confirmation) return;
    const expiryKey = JSON.stringify([key, ready.fingerprint, ready.confirmation.confirmedAt, ready.confirmation.expiresAt]);
    const expire = () => {
      setClock(value => value + 1);
      if (lastExpiredRefresh.current !== expiryKey) { lastExpiredRefresh.current = expiryKey; void reload(); }
    };
    const remaining = confirmationDeadline(ready) - Date.now();
    if (remaining <= 0) { if (lastExpiredRefresh.current !== expiryKey) expire(); return; }
    const timer = window.setTimeout(expire, remaining + 5);
    return () => clearTimeout(timer);
  }, [ready, key, reload]);

  function isPublishReady() {
    const latest = snapshotRef.current;
    return latest.key === current.current.key && !latest.loading && !latest.error && !!latest.data?.canPublish
      && latest.data.vehicleVersion === current.current.version && publicationConfirmationIsCurrent(latest.data);
  }
  return {
    ready, loading: snapshot.key !== key || snapshot.loading, confirming: snapshot.key === key && snapshot.confirming,
    error: snapshot.key === key ? snapshot.error : '', expired: Boolean(ready?.confirmation && !publicationConfirmationIsCurrent(ready)),
    reload, confirm: (receipt: ConfirmPublicationPreviewRequest) => run(receipt), isPublishReady,
  };
}
