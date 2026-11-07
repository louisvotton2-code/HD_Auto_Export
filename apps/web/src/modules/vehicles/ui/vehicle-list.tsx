'use client';
import { useState } from 'react';
import type { Locale } from '@/i18n/routing';
import type { Vehicle, VehicleBody, VehicleFuel } from '../types';
import { filterVehicles } from '../filter';
import { vehicleMessages } from '../messages';
import { VehicleCard } from './vehicle-card';
import styles from './vehicles.module.css';

export function VehicleList({
  locale,
  initialVehicles,
}: {
  locale: Locale;
  initialVehicles: Vehicle[];
}) {
  const t = vehicleMessages(locale);
  const [query, setQuery] = useState('');
  const [fuel, setFuel] = useState<VehicleFuel | 'all'>('all');
  const [body, setBody] = useState<VehicleBody | 'all'>('all');
  const filtered =
    query || fuel !== 'all' || body !== 'all'
      ? filterVehicles(initialVehicles, { query, fuel, body })
      : initialVehicles;
  return (
    <main id="main" className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.listHeading}>
          <p className={styles.eyebrow}>{t.eyebrow}</p>
          <h1>{t.title}</h1>
          <p>{t.intro}</p>
        </div>
        <p className={styles.notice}>{t.notice}</p>
        <div className={styles.filters}>
          <label>
            <span>{t.search}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.search}
            />
          </label>
          <label>
            <span>{t.fuel}</span>
            <select
              value={fuel}
              onChange={(event) => setFuel(event.target.value as VehicleFuel | 'all')}
            >
              <option value="all">{t.all}</option>
              {(['electric', 'petrol', 'hybrid', 'lpg'] as const).map((item) => (
                <option key={item} value={item}>
                  {t[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t.body}</span>
            <select
              value={body}
              onChange={(event) => setBody(event.target.value as VehicleBody | 'all')}
            >
              <option value="all">{t.all}</option>
              {(['suv', 'sedan', 'hatchback'] as const).map((item) => (
                <option key={item} value={item}>
                  {t[item]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setFuel('all');
              setBody('all');
            }}
          >
            {t.reset}
          </button>
        </div>
        <p className={styles.count} aria-live="polite">
          {filtered.length} {t.results}
        </p>
        {filtered.length ? (
          <div className={styles.grid}>
            {filtered.map((vehicle) => (
              <VehicleCard key={vehicle.slug} vehicle={vehicle} locale={locale} />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>{t.empty}</p>
        )}
      </div>
    </main>
  );
}
