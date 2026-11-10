'use client';
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { Locale } from '@/i18n/routing';
import { partsContent } from '../content/parts-content';
import type { PartImage } from '../types';
import styles from './parts.module.css';

export function PartGallery({ images, title, locale }: { images: readonly PartImage[]; title: string; locale: Locale }) {
  const t = partsContent[locale], [index, setIndex] = useState(0), [enhanced, setEnhanced] = useState(false), [opened, setOpened] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), opener = useRef<HTMLElement | null>(null);
  const image = images[index] ?? images[0];
  useEffect(() => setEnhanced(true), []);
  useEffect(() => { if (!opened) return; const before = document.body.style.overflow; document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = before; }; }, [opened]);
  function open(event: MouseEvent<HTMLAnchorElement>) { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); opener.current = event.currentTarget; dialog.current?.showModal(); setOpened(true); }
  function key(event: KeyboardEvent<HTMLElement>) { if (!opened || images.length < 2) return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); setIndex((i) => (i + (event.key === 'ArrowLeft' ? -1 : 1) + images.length) % images.length); } }
  if (!image) return <div className={styles.noPhoto}>{t.noPhoto}</div>;
  return <div className={styles.gallery} data-part-gallery="" data-selected-image={image.id}>
    <a className={styles.mainImage} href={image.url} target="_blank" rel="noopener noreferrer" aria-label={t.openImage} onClick={enhanced ? open : undefined}><img src={image.url} alt={`${title} · ${t.referenceImage}`} width={1000} height={1000} /></a>
    <p className={styles.imageNote}>{t.referenceImage} · {index + 1} / {images.length}</p>
    {images.length > 1 && <nav className={styles.thumbnails} aria-label={t.photos}>{images.map((item, i) => <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" aria-label={t.image(i + 1)} aria-current={i === index ? 'true' : undefined} onClick={enhanced ? (event) => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); setIndex(i); } } : undefined}><img src={item.url} alt="" width={100} height={100} loading="lazy" /></a>)}</nav>}
    <dialog ref={dialog} className={styles.photoDialog} aria-label={t.photos} onKeyDown={key} onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }} onClose={() => { setOpened(false); opener.current?.focus({ preventScroll: true }); }}><button className={styles.closeImage} type="button" aria-label={t.closeImage} onClick={() => dialog.current?.close()}>×</button>{opened && <img src={image.url} alt={`${title} · ${t.referenceImage}`} width={1000} height={1000} />}{images.length > 1 && <div className={styles.photoArrows}><button type="button" aria-label={t.previousImage} onClick={() => setIndex((index - 1 + images.length) % images.length)}>‹</button><button type="button" aria-label={t.nextImage} onClick={() => setIndex((index + 1) % images.length)}>›</button></div>}</dialog>
  </div>;
}
