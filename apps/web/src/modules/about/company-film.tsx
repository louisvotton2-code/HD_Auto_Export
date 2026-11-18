'use client';

import { useRef, useState } from 'react';
import { Icon } from '@/shared/ui/icon';
import styles from './about.module.css';

export function CompanyFilm({ label }: { label: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const play = useRef<HTMLButtonElement>(null);
  const [started, setStarted] = useState(false);

  return (
    <div className={styles.video} data-started={started}>
      <video
        ref={video}
        aria-label={label}
        preload="none"
        poster="/media/about/company-film.webp"
        src="/media/about/company-film.mp4"
        controls
        playsInline
        onPlay={() => {
          if (document.activeElement === play.current) video.current?.focus();
          setStarted(true);
        }}
      />
      <button
        ref={play}
        type="button"
        aria-label={label}
        hidden={started}
        onClick={() => {
          void video.current?.play().catch(() => {
            video.current?.focus();
            setStarted(true);
          });
        }}
      >
        <Icon name="play" size={30} />
      </button>
    </div>
  );
}
