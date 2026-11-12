'use client';

import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  PublicationPreviewFrameMessageSchema,
  type PublicationPreview,
  type PublicationPreviewFrameMessage,
} from '@hd/contracts/admin';
import { PublicationPreviewDetail, type VehicleGalleryImageStatus } from '@/modules/vehicles';
import { previewContent } from '../content';
import { PreviewReadError, readPublicationPreview, type PreviewErrorCode } from '../read-preview';
import type { PreviewFrameScope } from '../scope';
import styles from './publication-preview-resource.module.css';

type PreviewState =
  | { phase: 'loading'; key: string }
  | { phase: 'error'; key: string; code: PreviewErrorCode }
  | { phase: 'ready'; key: string; preview: PublicationPreview };
const frameType = 'hd:auto:publication-preview';

function postFrame(message: PublicationPreviewFrameMessage) {
  if (window.parent === window) return;
  const parsed = PublicationPreviewFrameMessageSchema.safeParse(message);
  if (parsed.success) window.parent.postMessage(parsed.data, window.location.origin);
}

function PreviewStatus({ scope, code }: { scope: PreviewFrameScope; code?: PreviewErrorCode }) {
  const t = previewContent[scope.locale];
  return (
    <main className={styles.status} lang={scope.locale} data-testid="publication-preview-status" data-preview-error={code}>
      <h1>{t.title}</h1>
      <p role={code ? 'alert' : 'status'}>{code ? t.errors[code] : t.loading}</p>
      {code && <p>{t.reloadInAdmin}</p>}
    </main>
  );
}

class PreviewBoundary extends Component<{
  children: ReactNode; fallback: ReactNode; onFailure: () => void;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function RenderedPreview({ preview, scope }: {
  preview: PublicationPreview; scope: PreviewFrameScope;
}) {
  const container = useRef<HTMLDivElement>(null);
  const t = previewContent[scope.locale];
  const cover = preview.vehicle.images.find((image) => image.isCover && image.status === 'ready' && image.url);
  const gate = useRef({ active: true, failed: false, coverDecoded: false, currentId: null as string | null, currentKey: null as string | null, currentDecoded: false, sequence: 0 });
  const readyFrame = useRef(0);
  const [mediaFailed, setMediaFailed] = useState(false);
  const failMedia = useCallback(() => {
    if (!gate.current.active || gate.current.failed) return;
    gate.current.failed = true;
    cancelAnimationFrame(readyFrame.current);
    setMediaFailed(true);
    postFrame({ schemaVersion: 1, type: frameType, ...scope, event: 'error', error: { code: 'render_error' } });
  }, [scope]);
  const onImageStatus = useCallback(({ imageId, requestKey, status }: VehicleGalleryImageStatus) => {
    const current = gate.current;
    if (!current.active || current.failed) return;
    if (status !== 'loading' && (imageId !== current.currentId || requestKey !== current.currentKey)) return;
    if (status === 'loading' && requestKey === current.currentKey) return;
    if (status === 'ready' && current.currentDecoded) return;
    cancelAnimationFrame(readyFrame.current);
    if (!cover || imageId === null || requestKey === null) { failMedia(); return; }
    if (status === 'loading') {
      const firstImage = current.currentId === null;
      current.currentId = imageId;
      current.currentKey = requestKey;
      current.currentDecoded = false;
      current.sequence += 1;
      // The request boundary already announced initial loading; a new selection revokes its receipt once.
      if (!firstImage) postFrame({ schemaVersion: 1, type: frameType, ...scope, event: 'loading' });
      return;
    }
    // Late completion from a previous selection cannot change this frame's eligibility.
    if (status === 'error') { failMedia(); return; }
    current.currentDecoded = true;
    if (imageId === cover.id) current.coverDecoded = true;
    if (!current.coverDecoded) return;
    const sequence = current.sequence;
    readyFrame.current = requestAnimationFrame(() => {
      if (!current.active || current.failed || !current.currentDecoded || current.sequence !== sequence) return;
      const node = container.current;
      const image = [...(node?.querySelectorAll<HTMLImageElement>('[data-gallery-active-image]') ?? [])]
        .find((item) => item.dataset.galleryActiveImage === current.currentId);
      if (!node?.isConnected || !node.querySelector('[data-testid="publication-preview-body"]') || node.dataset.previewFingerprint !== preview.fingerprint
        || !image?.complete || image.naturalWidth <= 0 || node.querySelector('[data-gallery-image-error]')) {
        failMedia();
        return;
      }
      postFrame({ schemaVersion: 1, type: frameType, ...scope, event: 'ready', preview: {
        vehicleId: preview.vehicle.id, vehicleVersion: preview.vehicleVersion,
        publicContentRevision: preview.publicContentRevision, fingerprint: preview.fingerprint,
        locale: preview.locale,
      } });
    });
  }, [cover, failMedia, preview, scope]);

  useLayoutEffect(() => {
    gate.current.active = true;
    return () => {
      gate.current.active = false;
      cancelAnimationFrame(readyFrame.current);
    };
  }, []);
  useEffect(() => {
    const node = container.current;
    let heightFrame = 0;
    let previousHeight = 0;
    let active = true;
    const base = { schemaVersion: 1, type: frameType, ...scope } as const;
    if (!cover) failMedia();
    function measure() {
      cancelAnimationFrame(heightFrame);
      heightFrame = requestAnimationFrame(() => {
        if (!active || !node?.isConnected) return;
        const height = Math.min(16000, Math.max(240, Math.ceil(node.getBoundingClientRect().height)));
        if (height !== previousHeight) {
          previousHeight = height;
          postFrame({ ...base, event: 'resize', height });
        }
      });
    }
    const observer = new ResizeObserver(measure);
    if (node) observer.observe(node);
    measure();
    function stop() {
      active = false;
      gate.current.active = false;
      cancelAnimationFrame(readyFrame.current);
      cancelAnimationFrame(heightFrame);
      observer.disconnect();
    }
    window.addEventListener('pagehide', stop);
    return () => {
      stop();
      window.removeEventListener('pagehide', stop);
    };
  }, [cover, failMedia, scope]);

  return (
    <div ref={container} data-preview-fingerprint={preview.fingerprint}>
      <div className={styles.context} lang={scope.locale}>
        <strong>{t.version} {preview.vehicleVersion} · {t.revision} {preview.publicContentRevision}</strong>
        <span>{t.note}</span>
        {mediaFailed && <p role="alert" data-testid="publication-preview-media-error">{t.errors.render_error} {t.reloadInAdmin}</p>}
      </div>
      <PublicationPreviewDetail preview={preview} onActiveImageStatus={onImageStatus} />
    </div>
  );
}

export function PublicationPreviewResource({ scope }: { scope: PreviewFrameScope }) {
  const scopeKey = `${scope.vehicleId}:${scope.locale}:${scope.loadId}`;
  const [state, setState] = useState<PreviewState>({ phase: 'loading', key: scopeKey });
  const failRender = useCallback(() => {
    setState({ phase: 'error', key: scopeKey, code: 'render_error' });
    postFrame({ schemaVersion: 1, type: frameType, ...scope, event: 'error', error: { code: 'render_error' } });
  }, [scope, scopeKey]);

  useEffect(() => {
    document.documentElement.lang = scope.locale === 'zh' ? 'zh-Hans' : scope.locale;
    const controller = new AbortController();
    let active = true;
    const base = { schemaVersion: 1, type: frameType, ...scope } as const;
    setState({ phase: 'loading', key: scopeKey });
    postFrame({ ...base, event: 'loading' });
    const timeout = window.setTimeout(() => {
      if (!active) return;
      active = false;
      controller.abort();
      setState({ phase: 'error', key: scopeKey, code: 'unavailable' });
      postFrame({ ...base, event: 'error', error: { code: 'unavailable' } });
    }, 15000);
    void readPublicationPreview(scope, controller.signal).then((preview) => {
      if (active) setState({ phase: 'ready', key: scopeKey, preview });
    }).catch((error: unknown) => {
      if (!active) return;
      const code = error instanceof PreviewReadError ? error.code : 'unavailable';
      setState({ phase: 'error', key: scopeKey, code });
      postFrame({ ...base, event: 'error', error: { code } });
    }).finally(() => window.clearTimeout(timeout));
    const pageHidden = () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
      setState({ phase: 'error', key: scopeKey, code: 'unavailable' });
      postFrame({ ...base, event: 'disposed' });
    };
    window.addEventListener('pagehide', pageHidden);
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
      window.removeEventListener('pagehide', pageHidden);
      postFrame({ ...base, event: 'disposed' });
    };
  }, [scope, scopeKey]);

  if (state.key !== scopeKey) return <PreviewStatus scope={scope} />;
  if (state.phase !== 'ready') return <PreviewStatus scope={scope} code={state.phase === 'error' ? state.code : undefined} />;
  return (
    <PreviewBoundary key={scope.loadId} onFailure={failRender} fallback={<PreviewStatus scope={scope} code="render_error" />}>
      <RenderedPreview preview={state.preview} scope={scope} />
    </PreviewBoundary>
  );
}
