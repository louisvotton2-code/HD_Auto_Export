'use client';

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  PublicationPreviewFrameMessageSchema,
  type PublicationPreview,
  type PublicationPreviewFrameMessage,
} from '@hd/contracts/admin';
import { PublicationPreviewDetail } from '@/modules/vehicles';
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

function PreviewStatus({ scope, code, retry }: { scope: PreviewFrameScope; code?: PreviewErrorCode; retry?: () => void }) {
  const t = previewContent[scope.locale];
  return (
    <main className={styles.status} lang={scope.locale} data-testid="publication-preview-status" data-preview-error={code}>
      <h1>{t.title}</h1>
      <p role={code ? 'alert' : 'status'}>{code ? t.errors[code] : t.loading}</p>
      {retry && <button type="button" onClick={retry}>{t.retry}</button>}
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

function RenderedPreview({ preview, scope, onFailure }: {
  preview: PublicationPreview; scope: PreviewFrameScope; onFailure: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const t = previewContent[scope.locale];
  useEffect(() => {
    const node = container.current;
    let heightFrame = 0;
    let previousHeight = 0;
    let active = true;
    const base = { schemaVersion: 1, type: frameType, ...scope } as const;
    const readyFrame = requestAnimationFrame(() => {
      if (!active) return;
      if (!node?.isConnected || !node.querySelector('[data-testid="publication-preview-body"]') || node.dataset.previewFingerprint !== preview.fingerprint) {
        onFailure();
        return;
      }
      postFrame({ ...base, event: 'ready', preview: {
        vehicleId: preview.vehicle.id, vehicleVersion: preview.vehicleVersion,
        publicContentRevision: preview.publicContentRevision, fingerprint: preview.fingerprint,
        locale: preview.locale,
      } });
    });
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
      cancelAnimationFrame(readyFrame);
      cancelAnimationFrame(heightFrame);
      observer.disconnect();
    }
    window.addEventListener('pagehide', stop);
    return () => {
      stop();
      window.removeEventListener('pagehide', stop);
    };
  }, [preview, scope, onFailure]);

  return (
    <div ref={container} data-preview-fingerprint={preview.fingerprint}>
      <div className={styles.context} lang={scope.locale}>
        <strong>{t.version} {preview.vehicleVersion} · {t.revision} {preview.publicContentRevision}</strong>
        <span>{t.note}</span>
      </div>
      <PublicationPreviewDetail preview={preview} />
    </div>
  );
}

export function PublicationPreviewResource({ scope }: { scope: PreviewFrameScope }) {
  const scopeKey = `${scope.vehicleId}:${scope.locale}:${scope.loadId}`;
  const [state, setState] = useState<PreviewState>({ phase: 'loading', key: scopeKey });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
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
  }, [scope, scopeKey, attempt]);

  if (state.key !== scopeKey) return <PreviewStatus scope={scope} />;
  if (state.phase !== 'ready') return <PreviewStatus scope={scope} code={state.phase === 'error' ? state.code : undefined} retry={state.phase === 'error' ? retry : undefined} />;
  return (
    <PreviewBoundary key={`${scope.loadId}:${attempt}`} onFailure={failRender} fallback={<PreviewStatus scope={scope} code="render_error" retry={retry} />}>
      <RenderedPreview preview={state.preview} scope={scope} onFailure={failRender} />
    </PreviewBoundary>
  );
}
