'use client';

import { useEffect, useRef, type ReactNode } from 'react';

function unitInterval(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function AboutMotion({ className, children }: { className: string; children: ReactNode }) {
  const page = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = page.current;
    if (!root || !('IntersectionObserver' in window)) return;

    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const hero = root.querySelector<HTMLElement>('[data-about-hero]');
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-about-reveal]'));
    if (hero) sections.unshift(hero);

    const nearby = new Set<Element>();
    let frame = 0;

    function update() {
      frame = 0;
      const viewport = window.innerHeight;
      const values = Array.from(nearby, (element) => {
        const bounds = element.getBoundingClientRect();
        const progress = element === hero
          ? window.scrollY / Math.max(1, bounds.height * .72)
          : (viewport - bounds.top) / Math.max(1, Math.min(bounds.height, viewport * .56));
        return [element as HTMLElement, unitInterval(progress).toFixed(3)] as const;
      });

      for (const [element, progress] of values) {
        element.style.setProperty('--about-progress', progress);
        element.dataset.aboutMotion = '';
      }
    }

    function schedule() {
      if (!frame && nearby.size && !preference.matches) frame = window.requestAnimationFrame(update);
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) nearby.add(entry.target);
        else nearby.delete(entry.target);
      }
      schedule();
    }, { rootMargin: '160px 0px' });

    for (const section of sections) observer.observe(section);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    preference.addEventListener('change', schedule);

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      preference.removeEventListener('change', schedule);
    };
  }, []);

  return <main id="main" ref={page} className={className}>{children}</main>;
}
