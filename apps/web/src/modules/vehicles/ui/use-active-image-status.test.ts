import { describe, expect, it, vi } from 'vitest';
import { useActiveImageStatus } from './use-active-image-status';

const effects = vi.hoisted(() => [] as Array<() => void | (() => void)>);
vi.mock('react', () => ({
  useLayoutEffect: (setup: () => void | (() => void)) => effects.push(setup),
}));

describe('staff preview image status', () => {
  it('delivers the first already-failed image after the parent gate mounts and discards Strict Mode replay', async () => {
    const image = Object.assign(new EventTarget(), {
      isConnected: true, dataset: { galleryActiveImage: 'cover' },
      complete: true, naturalWidth: 0,
    }) as unknown as HTMLImageElement;
    const received: string[] = [];
    let parentActive = false;
    useActiveImageStatus({
      imageRef: { current: image }, imageId: 'cover', imageKey: 'load-1:cover',
      onStatus: event => { if (parentActive) received.push(event.status); },
    });
    const setup = effects.shift()!;
    const abandoned = setup();
    abandoned?.();
    const cleanup = setup();
    parentActive = true;
    await Promise.resolve();
    expect(received).toEqual(['loading', 'error']);
    cleanup?.();
  });

  it('drops an obsolete failed request when a new image is already decoding', async () => {
    const createImage = (id: string, naturalWidth: number) => Object.assign(new EventTarget(), {
      isConnected: true, dataset: { galleryActiveImage: id },
      complete: true, naturalWidth, decode: async () => {},
    }) as unknown as HTMLImageElement;
    const received: string[] = [];
    for (const [id, width] of [['old', 0], ['next', 640]] as const) {
      useActiveImageStatus({
        imageRef: { current: createImage(id, width) }, imageId: id, imageKey: id,
        onStatus: event => received.push(`${event.requestKey}:${event.status}`),
      });
    }
    effects.shift()!()?.();
    const cleanup = effects.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(received).toEqual(['next:loading', 'next:ready']);
    cleanup?.();
  });
});
