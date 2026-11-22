'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { preload } from 'react-dom';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { homeContent } from '../content/home-content';
import { HeroStats } from './hero-stats';
import styles from './home-hero.module.css';

const roadImagePath = '/media/home/dawn-convoy.webp';
const roadImageSrcSet = [576, 1056, 1440]
  .map((width) => `/media/home/dawn-convoy-${width}.webp ${width}w`)
  .concat(`${roadImagePath} 1536w`)
  .join(', ');
// Keep in sync with roadFrame: cover scales the 3:2 image by width or 1.5 × height.
const desktopCoverWidth = 'calc(1.5 * (clamp(520px, 100svh - 346px, 800px) - clamp(100px, 12svh, 138px) - clamp(28px, 5svh, 52px)))';
const roadImageSizes = [
  '(max-width: 760px) max(100vw, clamp(360px, 111vw, 738px))',
  `(max-width: 1050px) max(calc(74vw - clamp(22px, 5.6vw, 86px)), ${desktopCoverWidth})`,
  `max(min(972.4px, calc(70vw - clamp(22px, 5.6vw, 86px))), ${desktopCoverWidth})`,
].join(', ');

export function HomeHero({
  locale,
  catalogTotal,
  children,
}: {
  locale: Locale;
  catalogTotal: number | null;
  children: ReactNode;
}) {
  const hero = useRef<HTMLElement>(null);
  const scrollCue = useRef<HTMLAnchorElement>(null);
  const t = homeContent[locale];

  preload(roadImagePath, {
    as: 'image',
    imageSrcSet: roadImageSrcSet,
    imageSizes: roadImageSizes,
    fetchPriority: 'high',
  });
  preload('/fonts/inter-latin.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  if (locale === 'ru') {
    preload('/fonts/inter-cyrillic.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  }

  useEffect(() => {
    const node = hero.current;
    if (!node || !('IntersectionObserver' in window)) return;

    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const touchPointer = matchMedia('(pointer: coarse)');
    const hasScrollTimeline = CSS.supports('animation-timeline', 'scroll(root block)')
      && CSS.supports('animation-range', '0px clamp(190px, 72vw, 330px)');
    const usesNativeDrive = () => hasScrollTimeline && touchPointer.matches;
    let visible = false;
    let frame = 0;
    let lastFrame = 0;
    let width = 0;
    let distance = 0;
    let displayed = Number.parseFloat(node.style.getPropertyValue('--drive-progress')) || 0;
    let target = displayed;
    let touchY: number | null = null;
    let swipeOrigin: { x: number; y: number; scroll: number } | null = null;
    let touchFrame = 0;
    let touchDirection = 0;
    let releaseTimer: number | undefined;

    const paintProgress = () => {
      node.style.setProperty('--drive-progress', displayed.toFixed(3));
    };

    const cancel = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      lastFrame = 0;
    };

    function update(time: number) {
      frame = 0;
      if (!node || !visible || preference.matches) return;
      // Time-based easing keeps touch momentum consistent on 60Hz and 120Hz displays.
      const elapsed = lastFrame ? Math.min(time - lastFrame, 60) : 1000 / 60;
      lastFrame = time;
      displayed += (target - displayed) * (1 - Math.exp(-elapsed / 42));
      if (Math.abs(target - displayed) < .002) displayed = target;
      paintProgress();
      if (displayed !== target) frame = requestAnimationFrame(update);
      else lastFrame = 0;
    }

    function schedule(scrollPosition = window.scrollY) {
      if (usesNativeDrive() || !visible || preference.matches) return;
      let next = Math.max(0, Math.min(1, scrollPosition / distance));
      // A mobile toolbar can move the document against the current swipe.
      if (touchDirection > 0) next = Math.max(next, target, displayed);
      if (touchDirection < 0) next = Math.min(next, target, displayed);
      // Ignore subpixel bounce around a settled scroll position while keeping both ends exact.
      if (next === 0 || next === 1 || Math.abs(next - target) * distance >= 1.5) target = next;
      const lag = target - displayed;
      // Touch updates can arrive several frames apart. Show the sweep while the image
      // is still in view, then ease the rest of the way to the current scroll position.
      if ((touchDirection || touchPointer.matches) && Math.abs(lag) * distance >= 48) {
        displayed += lag * .72;
        paintProgress();
      }
      if (!frame && displayed !== target) frame = requestAnimationFrame(update);
    }

    function clearTouch() {
      window.clearTimeout(releaseTimer);
      cancelAnimationFrame(touchFrame);
      touchFrame = 0;
      touchY = null;
      swipeOrigin = null;
      touchDirection = 0;
    }

    function startTouch(event: TouchEvent) {
      if (usesNativeDrive() || preference.matches) return;
      if (event.touches.length !== 1) {
        clearTouch();
        return;
      }
      window.clearTimeout(releaseTimer);
      const finger = event.touches[0];
      touchY = finger.screenY;
      touchDirection = 0;
      swipeOrigin = { x: finger.screenX, y: finger.screenY, scroll: window.scrollY };
    }

    function moveTouch(event: TouchEvent) {
      if (touchY === null || !swipeOrigin || event.touches.length !== 1) return;
      const finger = event.touches[0];
      const nextY = finger.screenY;
      const total = swipeOrigin.y - nextY;
      if (Math.abs(finger.screenX - swipeOrigin.x) > Math.abs(total)) return;
      const delta = touchY - nextY;
      if (Math.abs(delta) < 5) return;
      touchY = nextY;
      const direction = Math.sign(delta);
      if ((target - displayed) * direction < 0) target = displayed;
      touchDirection = direction;
      cancelAnimationFrame(touchFrame);
      touchFrame = requestAnimationFrame(() => {
        touchFrame = 0;
        // Older iOS can deliver the gesture before it reports the native scroll offset.
        if (swipeOrigin && window.scrollY === swipeOrigin.scroll) {
          const lead = Math.max(-96, Math.min(96, total));
          schedule(swipeOrigin.scroll + lead);
        }
      });
    }

    function endTouch() {
      touchY = null;
      swipeOrigin = null;
      cancelAnimationFrame(touchFrame);
      if (!touchDirection) return;
      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(() => {
        clearTouch();
        schedule();
      }, 240);
    }

    function onScroll() {
      // Keep the swipe direction through native momentum, until scrolling settles.
      if (touchY === null && touchDirection) endTouch();
      schedule();
    }

    function measure() {
      // Mobile browser chrome can resize vertically without a change to the hero layout.
      if (!node || width === node.clientWidth) return;
      width = node.clientWidth;
      distance = Math.max(190, Math.min(width * .72, 330));
      schedule();
    }

    function changePreference() {
      if (preference.matches) cancel();
      else schedule();
    }

    measure();
    paintProgress();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === node) {
          visible = entry.isIntersecting;
          if (visible) schedule();
          else cancel();
        } else if (entry.target instanceof HTMLElement) {
          entry.target.toggleAttribute('data-scroll-cue-active', entry.isIntersecting);
        }
      }
    });
    observer.observe(node);
    if (scrollCue.current) observer.observe(scrollCue.current);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('touchstart', startTouch, { passive: true });
    window.addEventListener('touchmove', moveTouch, { passive: true });
    window.addEventListener('touchend', endTouch, { passive: true });
    window.addEventListener('touchcancel', endTouch, { passive: true });
    window.addEventListener('wheel', clearTouch, { passive: true });
    window.addEventListener('click', clearTouch, { capture: true });
    preference.addEventListener('change', changePreference);

    return () => {
      cancel();
      clearTouch();
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', measure);
      window.removeEventListener('touchstart', startTouch);
      window.removeEventListener('touchmove', moveTouch);
      window.removeEventListener('touchend', endTouch);
      window.removeEventListener('touchcancel', endTouch);
      window.removeEventListener('wheel', clearTouch);
      window.removeEventListener('click', clearTouch, { capture: true });
      preference.removeEventListener('change', changePreference);
    };
  }, []);

  return (
    <section className={styles.hero} data-home-section="hero" ref={hero}>
      <div className={styles.heroStage}>
        <div className={styles.roadFrame} aria-hidden="true">
          <img
            srcSet={roadImageSrcSet}
            sizes={roadImageSizes}
            src={roadImagePath}
            alt=""
            width={1536}
            height={1024}
            fetchPriority="high"
            decoding="async"
            className={styles.roadImage}
          />
          <div className={styles.roadLight} data-testid="hero-road-light" />
        </div>
        <div className={`${styles.wrap} ${styles.heroContent}`}>
          <p className={styles.origin}>{t.origin}</p>
          <h1><span>{t.title[0]}</span>{' '}<em>{t.title[1]}</em></h1>
          <p className={styles.subtitle}>{t.subtitle}</p>
        </div>
      </div>
      <div className={styles.dock}>
        <HeroStats locale={locale} catalogTotal={catalogTotal} />
      </div>
      {children}
      <a className={styles.scroll} href="#home-vehicles" ref={scrollCue}>
        <span className={styles.scrollLabel}>{t.scroll}</span>
        <span className={styles.scrollArrows} aria-hidden="true">
          <Icon name="chevron" size={24} />
          <Icon name="chevron" size={24} />
        </span>
      </a>
    </section>
  );
}
