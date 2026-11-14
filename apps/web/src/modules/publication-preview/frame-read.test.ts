import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePublicationPreviewFixture } from '@hd/contracts/fixtures';
import type { PublicationPreviewFrameMessage } from '@hd/contracts/admin';
import { startPreviewFrameRead, type PreviewReadState } from './frame-read';

const scope = {
  vehicleId: '00000000-0000-4000-8000-000000000001',
  loadId: '10000000-0000-4000-8000-000000000001',
  locale: 'en' as const,
};

function previewFrame() {
  const frame = new EventTarget();
  vi.stubGlobal('window', Object.assign(frame, { setTimeout, clearTimeout }));
  const owner = { current: null as AbortController | null };
  const messages: PublicationPreviewFrameMessage[] = [];
  const states: PreviewReadState[] = [];
  return {
    frame, owner, states, messages,
    mount: () => startPreviewFrameRead(scope, owner, state => states.push(state), message => messages.push(message)),
  };
}

function previewResponse() {
  return Response.json({ data: makePublicationPreviewFixture('en'), meta: { requestId: 'fixture' } });
}

function nextTurn() {
  return new Promise<void>(resolve => setImmediate(resolve));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('staff preview frame effect lifecycle', () => {
  it('coalesces the first Strict Mode setup-cleanup-setup into one authenticated read without terminal disposal', async () => {
    const fetcher = vi.fn(async () => previewResponse());
    vi.stubGlobal('fetch', fetcher);
    const { mount, owner, messages, states } = previewFrame();
    const stopFirst = mount();
    const first = owner.current!;
    stopFirst();
    const stopCurrent = mount();
    try {
      await nextTurn();
      expect(first.signal.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher).toHaveBeenCalledWith(
        `/api/v1/admin/vehicles/${scope.vehicleId}/publication-preview?locale=en`,
        expect.objectContaining({ credentials: 'same-origin', signal: owner.current!.signal }),
      );
      expect(messages.map(message => message.event)).toEqual(['loading']);
      expect(states.map(state => state.phase)).toEqual(['loading', 'ready']);
    } finally {
      stopCurrent();
      await nextTurn();
    }
    // Internal DTO ready does not emit a ready receipt. The image gate owns it.
    expect(messages.map(message => message.event)).toEqual(['loading', 'disposed']);
    expect(messages.every(message => message.loadId === scope.loadId)).toBe(true);
  });

  it('revokes the exact load only once on pagehide and ignores a late successful response', async () => {
    const pending = Promise.withResolvers<Response>();
    vi.stubGlobal('fetch', vi.fn(() => pending.promise));
    const { mount, frame, owner, states, messages } = previewFrame();
    const stop = mount();
    await nextTurn();
    frame.dispatchEvent(new Event('pagehide'));
    stop();
    pending.resolve(previewResponse());
    await nextTurn();

    expect(owner.current!.signal.aborted).toBe(true);
    expect(messages.map(message => message.event)).toEqual(['loading', 'disposed']);
    expect(messages.at(-1)).toMatchObject(scope);
    expect(states).toEqual([{ phase: 'loading' }, { phase: 'error', code: 'unavailable' }]);
  });

  it('terminates an unresponsive read at fifteen seconds and rejects its late response', async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<Response>();
    vi.stubGlobal('fetch', vi.fn(() => pending.promise));
    const { mount, owner, states, messages } = previewFrame();
    const stop = mount();
    try {
      await vi.advanceTimersByTimeAsync(14_999);
      expect(messages.map(message => message.event)).toEqual(['loading']);
      await vi.advanceTimersByTimeAsync(1);
      pending.resolve(previewResponse());
      await vi.advanceTimersByTimeAsync(0);
      expect(owner.current!.signal.aborted).toBe(true);
      expect(messages.map(message => message.event)).toEqual(['loading', 'error']);
      expect(states).toEqual([{ phase: 'loading' }, { phase: 'error', code: 'unavailable' }]);
    } finally {
      stop();
      await vi.advanceTimersByTimeAsync(0);
    }
  });
});
