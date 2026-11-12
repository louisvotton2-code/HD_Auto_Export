export type CountUpClock = {
  now: () => number;
  request: (callback: (time: number) => void) => number;
  cancel: (id: number) => void;
};

/** A cancellable, single-run cubic ease-out. The caller decides when motion is appropriate. */
export function animateCount(
  target: number,
  update: (value: number) => void,
  clock: CountUpClock,
  duration = 2000,
): () => void {
  if (!Number.isSafeInteger(target) || target < 0)
    throw new RangeError('A count must be a non-negative safe integer.');

  let active = true;
  let frame: number | undefined;
  const stop = () => {
    active = false;
    if (frame !== undefined) clock.cancel(frame);
    frame = undefined;
  };
  if (target === 0 || duration <= 0 || !Number.isFinite(duration)) {
    update(target);
    return stop;
  }

  const start = clock.now();
  update(0);
  const tick = (time: number) => {
    frame = undefined;
    if (!active) return;
    const progress = Math.min(1, Math.max(0, (time - start) / duration));
    const eased = 1 - (1 - progress) ** 3;
    update(progress === 1 ? target : Math.round(target * eased));
    if (active && progress < 1) frame = clock.request(tick);
    else active = false;
  };
  frame = clock.request(tick);
  return stop;
}
