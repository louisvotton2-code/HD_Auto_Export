'use client';

import { useEffect, useRef } from 'react';
import styles from './home.module.css';

const SPEED_PX_PER_SECOND = 28;

/** Measure one complete repeat, including its trailing gap, so inventory never changes the speed. */
export function BrandMarquee({ brands, paused }: { brands: string[]; paused: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const identity = JSON.stringify(brands);
  useEffect(() => {
    const node = track.current, repeat = group.current;
    if (!node || !repeat) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const distance = repeat.getBoundingClientRect().width;
      if (!(distance > 0)) return;
      node.style.setProperty('--brand-distance', `${distance}px`);
      node.style.setProperty('--brand-duration', `${distance / SPEED_PX_PER_SECOND}s`);
      node.dataset.marqueeReady = 'true';
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(repeat);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      document.fonts?.removeEventListener('loadingdone', measure);
    };
  }, [identity]);
  if (!brands.length) return null;
  return <div className={styles.brands} aria-label={brands.join(', ')} data-brand-marquee>
    <div ref={track} className={styles.brandMarquee} data-paused={paused} data-brand-speed={SPEED_PX_PER_SECOND}>
      {[false, true].map(duplicate => <div key={String(duplicate)} ref={duplicate ? undefined : group}
        className={styles.brandGroup} aria-hidden={duplicate || undefined} data-brand-group={duplicate ? 'copy' : 'original'}>
        {brands.map((brand, index) => <span key={`${brand}-${index}`}>{brand}</span>)}
      </div>)}
    </div>
  </div>;
}
