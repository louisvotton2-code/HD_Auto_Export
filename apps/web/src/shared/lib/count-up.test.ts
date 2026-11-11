import { describe, expect, it } from 'vitest';
import { animateCount, type CountUpClock } from './count-up';

function frameClock() {
  let time = 0;
  let id = 0;
  const pending = new Map<number, (time: number) => void>();
  const clock: CountUpClock = {
    now: () => time,
    request: (callback) => {
      pending.set(++id, callback);
      return id;
    },
    cancel: (key) => {
      pending.delete(key);
    },
  };
  return {
    clock,
    pending,
    advance(next: number) {
      time = next;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(time));
    },
  };
}

describe('hero count-up lifecycle', () => {
  it('starts at zero, eases faster than linear and finishes at the exact target once', () => {
    const frames = frameClock();
    const values: number[] = [];
    animateCount(100, (value) => values.push(value), frames.clock);
    expect(values).toEqual([0]);
    expect(frames.pending.size).toBe(1);
    frames.advance(1000);
    expect(values.at(-1)).toBeGreaterThan(50);
    expect(values.at(-1)).toBeLessThan(100);
    frames.advance(2000);
    expect(values.at(-1)).toBe(100);
    expect(frames.pending.size).toBe(0);
    frames.advance(5000);
    expect(values.filter((value) => value === 100)).toHaveLength(1);
  });

  it('cancels the queued frame and rejects an already-delivered stale callback', () => {
    const frames = frameClock();
    const values: number[] = [];
    const stop = animateCount(660, (value) => values.push(value), frames.clock);
    const stale = [...frames.pending.values()][0]!;
    stop();
    stop();
    stale(1500);
    expect(frames.pending.size).toBe(0);
    expect(values).toEqual([0]);
  });

  it('can stop from an update without scheduling another frame', () => {
    const frames = frameClock();
    const values: number[] = [];
    let stop = () => {};
    stop = animateCount(20, (value) => {
      values.push(value);
      if (value > 0) stop();
    }, frames.clock);
    frames.advance(400);
    expect(values.at(-1)).toBeGreaterThan(0);
    expect(frames.pending.size).toBe(0);
  });

  it('finishes after a background-sized time jump without replaying intermediate frames', () => {
    const frames = frameClock();
    const values: number[] = [];
    animateCount(3, (value) => values.push(value), frames.clock);
    frames.advance(60_000);
    expect(values).toEqual([0, 3]);
    expect(frames.pending.size).toBe(0);
  });

  it('does not schedule a frame for a real zero or a disabled duration', () => {
    const frames = frameClock();
    const values: number[] = [];
    animateCount(0, (value) => values.push(value), frames.clock);
    animateCount(3, (value) => values.push(value), frames.clock, 0);
    expect(values).toEqual([0, 3]);
    expect(frames.pending.size).toBe(0);
  });

  it('rejects invalid count facts before starting an animation', () => {
    const frames = frameClock();
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => animateCount(value, () => {}, frames.clock)).toThrow(RangeError);
    expect(frames.pending.size).toBe(0);
  });
});
