'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const easeOut = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

/** Progressive enhancement only: content is visible before hydration and without JS. */
export function InteractionMotion() {
  const pathname = usePathname();
  const revealed = useRef(new WeakSet<Element>());

  useEffect(() => {
    const preference = window.matchMedia(reducedMotionQuery);
    const active = new Set<Animation>();
    let observer: IntersectionObserver | undefined;

    function stop() {
      observer?.disconnect();
      for (const animation of active) animation.cancel();
      active.clear();
    }

    function observe() {
      stop();
      if (preference.matches || !('IntersectionObserver' in window)) return;
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer?.unobserve(entry.target);
            if (revealed.current.has(entry.target)) continue;
            revealed.current.add(entry.target);
            if (typeof entry.target.animate !== 'function') continue;
            const animation = entry.target.animate(
              [
                { opacity: 0.78, transform: 'translateY(8px)' },
                { opacity: 1, transform: 'translateY(0)' },
              ],
              { duration: 240, easing: easeOut },
            );
            active.add(animation);
            animation.onfinish = () => active.delete(animation);
          }
        },
        { threshold: 0.08 },
      );
      document.querySelectorAll('[data-motion-reveal]').forEach((node) => observer?.observe(node));
    }

    observe();
    preference.addEventListener('change', observe);
    return () => {
      stop();
      preference.removeEventListener('change', observe);
    };
  }, [pathname]);

  return null;
}

/** The amount changes immediately; only its new presentation is briefly emphasized. */
export function useValueHighlight(value: string) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(value);

  useEffect(() => {
    const changed = previous.current !== value;
    previous.current = value;
    const node = ref.current;
    if (!changed || !node || typeof node.animate !== 'function') return;
    const preference = window.matchMedia(reducedMotionQuery);
    if (preference.matches) return;
    const animation = node.animate([{ opacity: 0.72 }, { opacity: 1 }], {
      duration: 200,
      easing: easeOut,
    });
    const cancel = () => {
      if (preference.matches) animation.cancel();
    };
    preference.addEventListener('change', cancel);
    return () => {
      animation.cancel();
      preference.removeEventListener('change', cancel);
    };
  }, [value]);

  return ref;
}
