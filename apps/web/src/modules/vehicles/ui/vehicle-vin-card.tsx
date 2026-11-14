'use client';

import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { publicVehicleRecordsCopy } from '../public-vehicle-records-copy';
import { vehicleVinCopy } from '../vehicle-vin-copy';
import styles from './vehicle-vin-card.module.css';

/** A VIN tile is absent rather than an invented placeholder when the source has no complete VIN. */
export function VehicleVinCard({ vin, locale, className }: {
  vin: string | null | undefined;
  locale: Locale;
  className?: string;
}) {
  if (!vin || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return null;
  return <VinValue key={vin} vin={vin} locale={locale} className={className} />;
}

function VinValue({ vin, locale, className }: { vin: string; locale: Locale; className?: string }) {
  const copy = vehicleVinCopy[locale];
  const [phase, setPhase] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (phase !== 'copied' && phase !== 'failed') return;
    const timer = window.setTimeout(() => setPhase('idle'), 3000);
    return () => window.clearTimeout(timer);
  }, [phase]);

  async function copyVin() {
    setPhase('copying');
    try {
      await navigator.clipboard.writeText(vin);
      if (mounted.current) setPhase('copied');
    } catch {
      if (mounted.current) setPhase('failed');
    }
  }

  return <div className={`${styles.card}${className ? ` ${className}` : ''}`} data-public-vehicle-vin>
    <p className={styles.label}>
      <span className={styles.icon}><Icon name="document" size={16} /></span>
      {publicVehicleRecordsCopy[locale].vin}
    </p>
    <div className={styles.value}>
      <code dir="ltr" data-vin-value>{vin}</code>
      <button className={styles.copy} type="button" onClick={copyVin} disabled={phase === 'copying'}
        aria-label={copy.copy} title={copy.copy} data-vin-copy-state={phase}>
        <Icon name={phase === 'copied' ? 'check' : 'copy'} size={17} />
      </button>
    </div>
    <p className={styles.feedback} role="status" aria-live="polite" aria-atomic="true" data-vin-feedback={phase}>
      {phase === 'copied' ? copy.copied : phase === 'failed' ? copy.failed : ''}
    </p>
  </div>;
}
