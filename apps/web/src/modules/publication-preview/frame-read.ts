import type { PublicationPreview, PublicationPreviewFrameMessage } from '@hd/contracts/admin';
import { PreviewReadError, readPublicationPreview, type PreviewErrorCode } from './read-preview';
import type { PreviewFrameScope } from './scope';

export type PreviewReadState =
  | { phase: 'loading' }
  | { phase: 'error'; code: PreviewErrorCode }
  | { phase: 'ready'; preview: PublicationPreview };

/** Own the read until the current effect is stopped or its frame navigates away. */
export function startPreviewFrameRead(
  scope: PreviewFrameScope,
  owner: { current: AbortController | null },
  onState: (state: PreviewReadState) => void,
  postFrame: (message: PublicationPreviewFrameMessage) => void,
) {
  const controller = new AbortController();
  owner.current = controller;
  const { signal } = controller;
  const base = { schemaVersion: 1, type: 'hd:auto:publication-preview', ...scope } as const;
  let disposed = false;

  function fail(code: PreviewErrorCode) {
    onState({ phase: 'error', code });
    postFrame({ ...base, event: 'error', error: { code } });
  }
  const timeout = window.setTimeout(() => {
    if (signal.aborted) return;
    controller.abort();
    fail('unavailable');
  }, 15_000);

  function stop() {
    window.clearTimeout(timeout);
    controller.abort();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    postFrame({ ...base, event: 'disposed' });
  }
  function pageHidden() {
    stop();
    onState({ phase: 'error', code: 'unavailable' });
    dispose();
  }
  window.addEventListener('pagehide', pageHidden);

  // Strict Mode replays setup and cleanup in the same turn. The discarded
  // setup must do neither a request nor a handshake with the parent.
  queueMicrotask(() => {
    if (signal.aborted) return;
    onState({ phase: 'loading' });
    postFrame({ ...base, event: 'loading' });
    void readPublicationPreview(scope, signal).then((preview) => {
      if (!signal.aborted) onState({ phase: 'ready', preview });
    }).catch((error: unknown) => {
      if (!signal.aborted) fail(error instanceof PreviewReadError ? error.code : 'unavailable');
    }).finally(() => window.clearTimeout(timeout));
  });

  return () => {
    stop();
    window.removeEventListener('pagehide', pageHidden);
    // A real unmount still revokes the receipt. An immediate replacement
    // effect takes ownership and announces loading instead.
    queueMicrotask(() => {
      if (owner.current === controller) dispose();
    });
  };
}
