'use client';
import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { partsContent } from '../content/parts-content';
import { usePartFavorites } from '../use-part-favorites';
import styles from './parts.module.css';

export function PartSaveButton({ slug, locale, detail = false }: { slug: string; locale: Locale; detail?: boolean }) {
  const { ids, toggle } = usePartFavorites(), [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  const saved = ids.includes(slug), t = partsContent[locale];
  return <button className={detail ? styles.detailSave : styles.save} type="button" aria-label={saved ? t.unsave : t.save} aria-pressed={saved} onClick={() => toggle(slug)}><span aria-hidden="true">{saved ? '♥' : '♡'}</span>{detail && <span>{saved ? t.unsave : t.save}</span>}</button>;
}
