'use client';

import { useCallback, useEffect, useRef, type FocusEvent, type PointerEvent } from 'react';

type TiltTarget = {
  node: HTMLElement;
  bounds: DOMRect;
};

/** Pointer-only presentation: one DOM write per frame, no React render on movement. */
export function usePointerTilt(layoutKey?: unknown) {
  const target = useRef<TiltTarget | null>(null);
  const frame = useRef<number | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const enabled = useRef(false);

  const reset = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const node = target.current?.node;
    if (node) {
      node.style.removeProperty('--card-tilt-x');
      node.style.removeProperty('--card-tilt-y');
      node.style.removeProperty('--card-light-x');
      node.style.removeProperty('--card-light-y');
      delete node.dataset.tiltActive;
    }
    target.current = null;
  }, []);

  useEffect(() => {
    const pointer = matchMedia('(hover: hover) and (pointer: fine)');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      enabled.current = pointer.matches && !reduced.matches;
      if (!enabled.current) reset();
    };
    update();
    pointer.addEventListener('change', update);
    reduced.addEventListener('change', update);
    window.addEventListener('blur', reset);
    window.addEventListener('resize', reset);
    // A tilted card can change the rail's scroll overflow and emit a scroll event itself.
    // Reset on the user's scroll intent instead, so that event cannot cancel its own tilt.
    window.addEventListener('wheel', reset, { passive: true });
    document.addEventListener('visibilitychange', reset);
    return () => {
      reset();
      pointer.removeEventListener('change', update);
      reduced.removeEventListener('change', update);
      window.removeEventListener('blur', reset);
      window.removeEventListener('resize', reset);
      window.removeEventListener('wheel', reset);
      document.removeEventListener('visibilitychange', reset);
    };
  }, [reset]);

  // A new resource or layout state can move the stable slot under a stationary pointer.
  // Reset before the next movement so its origin is measured from the current layout.
  useEffect(() => {
    reset();
  }, [reset, layoutKey]);

  const move = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (!enabled.current || event.pointerType !== 'mouse') {
        reset();
        return;
      }
      const node = event.currentTarget;
      if (target.current?.node !== node) {
        reset();
        // The stable slot remains flat even while this card is returning from a previous tilt.
        // Reading the transformed card here can otherwise shift its next pointer origin.
        target.current = {
          node,
          bounds: node.parentElement?.getBoundingClientRect() ?? node.getBoundingClientRect(),
        };
      }
      point.current = { x: event.clientX, y: event.clientY };
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        const active = target.current;
        if (!active) return;
        const { bounds } = active;
        const x = Math.max(0, Math.min(bounds.width, point.current.x - bounds.left));
        const y = Math.max(0, Math.min(bounds.height, point.current.y - bounds.top));
        // The reference card uses 1000px perspective and 0.025 degrees per pointer pixel.
        active.node.style.setProperty('--card-tilt-x', `${-(y - bounds.height / 2) * 0.025}deg`);
        active.node.style.setProperty('--card-tilt-y', `${(x - bounds.width / 2) * 0.025}deg`);
        active.node.style.setProperty('--card-light-x', `${(x / bounds.width) * 100}%`);
        active.node.style.setProperty('--card-light-y', `${(y / bounds.height) * 100}%`);
        active.node.dataset.tiltActive = 'true';
      });
    },
    [reset],
  );

  const focus = useCallback(
    (event: FocusEvent<HTMLElement>) => {
      // Pointer clicks focus links too. Only keyboard-visible focus should flatten the card;
      // flattening on a mouse click moves the target immediately before navigation.
      if (event.target.matches(':focus-visible')) reset();
    },
    [reset],
  );

  return {
    onPointerMove: move,
    onPointerLeave: reset,
    onPointerCancel: reset,
    onFocusCapture: focus,
  };
}

export type PointerTiltHandlers = ReturnType<typeof usePointerTilt>;
