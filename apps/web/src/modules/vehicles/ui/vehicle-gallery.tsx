'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type { PublicMedia } from '@hd/contracts/public';
import type { Locale } from '@/i18n/routing';
import { siteConfig } from '@/shared/config/site';
import { publicMediaUrl } from '@/shared/lib/public-media';
import { reportExternalPhotoFailure } from '../application/report-external-photo-failure';
import { detailContent } from '../detail-content';
import { VehiclePhotoFallback } from './vehicle-photo';
import { FavoriteVehicleButton } from './favorite-vehicle-button';
import styles from './vehicle-gallery.module.css';

export type VehicleDestination = { slug: string; label: string };
const imageResourceKey = (image: PublicMedia) => `${image.id}:${publicMediaUrl(image.url)}:${image.remote?.revision ?? 0}`;

/** Only selected originals load; a previously visited image stays briefly for the slide. */
export function VehicleGallery({
  images,
  title,
  locale,
}: {
  images: PublicMedia[];
  title: string;
  locale: Locale;
}) {
  const t = detailContent[locale];
  const ordered = useMemo(
    () =>
      [...images].sort(
        (a, b) => Number(b.isCover) - Number(a.isCover) || a.sortOrder - b.sortOrder,
      ),
    [images],
  );
  const [selectedId, setSelectedId] = useState(ordered[0]?.id ?? '');
  const [enhanced, setEnhanced] = useState(false);
  const [opened, setOpened] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [failedId, setFailedId] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [direction, setDirection] = useState(1);
  const [previousId, setPreviousId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pageOverflow = useRef<string | null>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const emptyPhoto = useRef<HTMLDivElement>(null);
  const selectedImage = useRef<HTMLImageElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const lastSwipeAt = useRef(0);
  const loadedImages = useRef(new Set<string>());
  const failedImages = useRef(new Set<string>());
  const captionId = useId();
  const index = Math.max(
    0,
    ordered.findIndex((image) => image.id === selectedId),
  );
  const selected = ordered[index];
  const hasPhoto = Boolean(selected);
  const previous = ordered.find((image) => image.id === previousId && image.id !== selected?.id);

  const restorePageScroll = useCallback(() => {
    if (pageOverflow.current === null) return;
    document.body.style.overflow = pageOverflow.current;
    pageOverflow.current = null;
  }, []);
  // A detail refresh can remove the last photo while the viewer owns the scroll lock.
  useLayoutEffect(() => restorePageScroll, [hasPhoto, restorePageScroll]);
  useEffect(() => setEnhanced(true), []);
  useEffect(() => {
    if (!selected) return;
    if (selectedId !== selected.id) setSelectedId(selected.id);
  }, [selected?.id, selectedId]);
  useEffect(() => {
    if (hasPhoto || !opened) return;
    opener.current = null;
    setOpened(false);
    emptyPhoto.current?.focus({ preventScroll: true });
  }, [hasPhoto, opened]);
  useEffect(() => {
    if (!previousId) return;
    const timeout = setTimeout(() => setPreviousId(null), 450);
    return () => clearTimeout(timeout);
  }, [previousId, selectedId]);
  useEffect(() => {
    const image = selectedImage.current;
    if (!selected || !image?.complete) return;
    // An SSR image may finish before hydration, or remain mounted during a quick return.
    if (image.naturalWidth > 0) loaded(selected);
    else failed(selected);
  }, [selected?.id, selected?.url, selected?.remote?.revision, retry]);

  function choose(nextIndex: number) {
    if (!ordered.length) return;
    const targetIndex = (nextIndex + ordered.length) % ordered.length;
    const image = ordered[targetIndex]!;
    if (image.id === selected?.id) return;
    setPreviousId(selected?.id ?? null);
    setDirection(nextIndex >= index ? 1 : -1);
    setSelectedId(image.id);
    const key = imageResourceKey(image);
    setLoadingId(loadedImages.current.has(key) || failedImages.current.has(key) ? null : key);
    setFailedId(failedImages.current.has(key) ? key : null);
  }
  function openViewer(event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (event.currentTarget.tagName === 'A' && Date.now() - lastSwipeAt.current < 450) return;
    const viewer = dialog.current;
    if (!viewer || viewer.open) return;
    viewer.showModal();
    opener.current = event.currentTarget;
    pageOverflow.current ??= document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setOpened(true);
  }
  function closeViewer() {
    const viewer = dialog.current;
    if (!viewer?.open) return;
    // Native close events are queued. Restore scrolling before closing the visible dialog.
    restorePageScroll();
    viewer.close();
    finishClose();
  }
  function finishClose() {
    const trigger = opener.current;
    if (!trigger || dialog.current?.open) return;
    opener.current = null;
    restorePageScroll();
    setOpened(false);
    const target = trigger.isConnected ? trigger : openButton.current;
    target?.focus({ preventScroll: true });
  }
  function keyNavigation(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || !enhanced) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      choose(index - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      choose(index + 1);
    }
  }
  function pointerStart(event: PointerEvent<HTMLElement>) {
    if (event.pointerType === 'touch') swipe.current = { x: event.clientX, y: event.clientY };
  }
  function pointerEnd(event: PointerEvent<HTMLElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const x = event.clientX - start.x,
      y = event.clientY - start.y;
    if (Math.abs(x) >= 45 && Math.abs(x) > Math.abs(y) * 1.3) {
      lastSwipeAt.current = Date.now();
      choose(index + (x < 0 ? 1 : -1));
    }
  }
  function loaded(image: PublicMedia) {
    const key = imageResourceKey(image);
    loadedImages.current.add(key);
    failedImages.current.delete(key);
    setLoadingId((current) => (current === key ? null : current));
    setFailedId((current) => (current === key ? null : current));
  }
  function failed(image: PublicMedia) {
    reportExternalPhotoFailure(image);
    const key = imageResourceKey(image);
    loadedImages.current.delete(key);
    failedImages.current.add(key);
    setLoadingId((current) => (current === key ? null : current));
    if (selected && imageResourceKey(selected) === key) setFailedId(key);
  }
  function retrySelected() {
    if (!selected) return;
    const key = imageResourceKey(selected);
    failedImages.current.delete(key);
    loadedImages.current.delete(key);
    setFailedId(null);
    setLoadingId(key);
    setRetry((value) => value + 1);
  }
  if (!selected) {
    return (
      <div className={styles.root}>
        <div className={styles.viewport} ref={emptyPhoto} tabIndex={-1} role="group" aria-label={t.gallery}>
          <VehiclePhotoFallback locale={locale} />
        </div>
      </div>
    );
  }
  const selectedKey = imageResourceKey(selected);

  return (
    <div
      className={styles.root}
      data-vehicle-gallery=""
      data-selected-image={selected.id}
      onKeyDown={keyNavigation}
    >
      <div
        className={styles.viewport}
        data-loading={loadingId === selectedKey}
        aria-busy={loadingId === selectedKey}
        onPointerDown={pointerStart}
        onPointerUp={pointerEnd}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <a
          className={styles.imageLink}
          href={publicMediaUrl(selected.url)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={enhanced ? openViewer : undefined}
          aria-label={`${t.openGallery} — ${t.imagePosition(index + 1, ordered.length)}`}
        >
          {[...(previous ? [previous] : []), selected].map((image) => (
            <img
              key={`${imageResourceKey(image)}:${retry}`}
              ref={(element) => {
                if (image.id === selected.id) selectedImage.current = element;
              }}
              className={styles.image}
              data-direction={direction}
              data-transition={Boolean(previous)}
              data-outgoing={image.id !== selected.id}
              src={publicMediaUrl(image.url)}
              alt={image.id === selected.id ? image.alt || title : ''}
              aria-hidden={image.id !== selected.id ? true : undefined}
              width={image.width ?? undefined}
              height={image.height ?? undefined}
              referrerPolicy={image.url.startsWith('https:') ? 'no-referrer' : undefined}
              fetchPriority="high"
              onLoad={() => loaded(image)}
              onError={() => failed(image)}
            />
          ))}
        </a>
        {enhanced && ordered.length > 1 && (
          <>
            <button
              type="button"
              className={`${styles.arrow} ${styles.previous}`}
              aria-label={t.previousImage}
              onClick={() => choose(index - 1)}
            >
              ‹
            </button>
            <button
              type="button"
              className={`${styles.arrow} ${styles.next}`}
              aria-label={t.nextImage}
              onClick={() => choose(index + 1)}
            >
              ›
            </button>
          </>
        )}
        <span className={styles.counter} aria-label={t.imagePosition(index + 1, ordered.length)}>
          {index + 1} / {ordered.length}
        </span>
        {loadingId === selectedKey && (
          <span className={styles.loading} role="status">
            {t.imageLoading}
          </span>
        )}
        {failedId === selectedKey && (
          <div className={styles.imageError} role="status">
            <p>{t.imageUnavailable}</p>
            <button type="button" onClick={retrySelected}>
              {t.retryImage}
            </button>
          </div>
        )}
      </div>
      <div className={styles.foot}>
        <nav className={styles.thumbnails} aria-label={t.gallery}>
          {ordered.map((image, imageIndex) => (
            <a
              key={image.id}
              className={styles.thumbnail}
              href={publicMediaUrl(image.url)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t.showImage(imageIndex + 1)}
              aria-current={image.id === selected.id ? 'true' : undefined}
              onClick={
                enhanced
                  ? (event) => {
                      if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
                        event.preventDefault();
                        choose(imageIndex);
                      }
                    }
                  : undefined
              }
            >
              {image.url.startsWith('/api/v1/media/') ? (
                <img
                  src={publicMediaUrl(image.url, { thumbnail: true })}
                  alt=""
                  width={144}
                  height={108}
                  loading="lazy"
                  fetchPriority="low"
                />
              ) : (
                <span className={styles.thumbnailNumber} aria-hidden="true">
                  {imageIndex + 1}
                </span>
              )}
            </a>
          ))}
        </nav>
        {enhanced && (
          <button ref={openButton} type="button" className={styles.open} onClick={openViewer}>
            ⛶ <span>{t.openGallery}</span>
          </button>
        )}
      </div>
      <span className={styles.srOnly} role="status">
        {t.imagePosition(index + 1, ordered.length)}
      </span>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-label={t.gallery}
        aria-describedby={captionId}
        onCancel={(event) => {
          event.preventDefault();
          closeViewer();
        }}
        onClose={finishClose}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeViewer();
        }}
        onKeyDown={keyNavigation}
      >
        <div
          className={styles.viewer}
          onPointerDown={pointerStart}
          onPointerUp={pointerEnd}
          onPointerCancel={() => {
            swipe.current = null;
          }}
        >
          <div className={styles.viewerHead}>
            <span id={captionId}>{t.imagePosition(index + 1, ordered.length)}</span>
            <button
              type="button"
              className={styles.close}
              aria-label={t.closeGallery}
              onClick={closeViewer}
            >
              ×
            </button>
          </div>
          <div className={styles.viewerImage}>
            {opened && (
              <img
                key={`${selectedKey}:${retry}`}
                src={publicMediaUrl(selected.url)}
                referrerPolicy={selected.url.startsWith('https:') ? 'no-referrer' : undefined}
                alt={selected.alt || title}
                width={selected.width ?? undefined}
                height={selected.height ?? undefined}
                onLoad={() => loaded(selected)}
                onError={() => failed(selected)}
              />
            )}
            {ordered.length > 1 && (
              <>
                <button
                  type="button"
                  className={`${styles.arrow} ${styles.previous}`}
                  aria-label={t.previousImage}
                  onClick={() => choose(index - 1)}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className={`${styles.arrow} ${styles.next}`}
                  aria-label={t.nextImage}
                  onClick={() => choose(index + 1)}
                >
                  ›
                </button>
              </>
            )}
            {loadingId === selectedKey && (
              <span className={styles.loading} role="status">
                {t.imageLoading}
              </span>
            )}
            {failedId === selectedKey && (
              <div className={styles.imageError} role="status">
                <p>{t.imageUnavailable}</p>
                <button type="button" onClick={retrySelected}>
                  {t.retryImage}
                </button>
              </div>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}

/** Shared favorite identities and a local share action; neither sends an inquiry. */
export function VehicleDetailActions({
  vehicleId,
  detailPath,
  title,
  locale,
}: {
  vehicleId: string;
  detailPath: string;
  title: string;
  locale: Locale;
}) {
  const t = detailContent[locale];
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!status) return;
    const timeout = setTimeout(() => setStatus(''), 3500);
    return () => clearTimeout(timeout);
  }, [status]);
  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={styles.share}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(new URL(detailPath, window.location.origin).href);
            setStatus(t.copied);
          } catch {
            setStatus(t.copyFailed);
          }
        }}
      >
        <span aria-hidden="true">↗</span> {t.share}
      </button>
      <FavoriteVehicleButton vehicleId={vehicleId} title={title} locale={locale} />
      <span className={styles.actionStatus} role="status">
        {status}
      </span>
    </div>
  );
}

export function VehicleBudgetPanel({
  locale,
  destinations,
}: {
  locale: Locale;
  destinations: VehicleDestination[];
}) {
  const t = detailContent[locale];
  const [enhanced, setEnhanced] = useState(false);
  const [selected, setSelected] = useState(destinations[0]?.slug ?? siteConfig.defaultCountrySlug);
  const choices = destinations.filter((item) => /^[a-z][a-z-]*$/.test(item.slug));
  const current =
    choices.find((item) => item.slug === selected)?.slug ??
    choices[0]?.slug ??
    siteConfig.defaultCountrySlug;
  useEffect(() => setEnhanced(true), []);
  return (
    <>
      {enhanced && choices.length ? (
        <label className={styles.destination}>
          <span>{t.destination}</span>
          <select value={current} onChange={(event) => setSelected(event.target.value)}>
            {choices.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      ) : choices.length ? (
        <nav className={styles.destinationLinks} aria-label={t.destination}>
          {choices.map((item) => (
            <a key={item.slug} href={`/${locale}/calculator/${item.slug}/`}>
              {item.label}
            </a>
          ))}
        </nav>
      ) : null}
      <a className={styles.calculatorLink} href={`/${locale}/calculator/${current}/`}>
        {t.fullCalculator}
        <span aria-hidden="true"> →</span>
      </a>
    </>
  );
}
