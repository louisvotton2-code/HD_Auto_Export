'use client';

import { useEffect, useRef } from 'react';
import {
  addRipple,
  advanceRippleScene,
  createRippleScene,
  drawRippleScene,
  type RippleScene,
} from './ripple-scene';

/** Independent rendering of the observed random and click-origin water ripples. */
export function HeroCanvas({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<RippleScene | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current,
      ctx = canvas?.getContext('2d'),
      hero = canvas?.parentElement;
    if (!canvas || !ctx || !hero) return;
    const scene = sceneRef.current ?? createRippleScene();
    sceneRef.current = scene;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)'),
      fine = matchMedia('(hover: hover) and (pointer: fine)');
    let width = 0,
      height = 0,
      frame = 0,
      lastTime = 0,
      visible = false;
    const canAnimate = () =>
      visible && !document.hidden && !paused && !reduced.matches && width > 0 && height > 0;
    const draw = () => drawRippleScene(ctx, scene, width, height);
    function tick(time: number) {
      frame = 0;
      if (!canAnimate()) {
        lastTime = 0;
        return;
      }
      if (lastTime) advanceRippleScene(scene, time - lastTime, width, height);
      lastTime = time;
      draw();
      frame = requestAnimationFrame(tick);
    }
    const restart = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      draw();
      if (canAnimate()) frame = requestAnimationFrame(tick);
    };
    const resize = new ResizeObserver(([entry]) => {
      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const ratio = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      restart();
    });
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      restart();
    });
    const onClick = (event: MouseEvent) => {
      if (!canAnimate() || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('a,button,input,select,textarea,summary,[role="button"]')) return;
      const rect = canvas.getBoundingClientRect(),
        x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      if (x >= 0 && x <= width && y >= 0 && y <= height) addRipple(scene, x, y);
    };
    const onMove = (event: PointerEvent) => {
      if (!canAnimate() || !fine.matches || event.pointerType !== 'mouse') return;
      const rect = canvas.getBoundingClientRect();
      scene.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    resize.observe(canvas);
    observer.observe(canvas);
    hero.addEventListener('click', onClick);
    hero.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('visibilitychange', restart);
    reduced.addEventListener('change', restart);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      hero.removeEventListener('click', onClick);
      hero.removeEventListener('pointermove', onMove);
      document.removeEventListener('visibilitychange', restart);
      reduced.removeEventListener('change', restart);
    };
  }, [paused]);
  return (
    <canvas
      ref={canvasRef}
      data-testid="hero-ripple-canvas"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}
