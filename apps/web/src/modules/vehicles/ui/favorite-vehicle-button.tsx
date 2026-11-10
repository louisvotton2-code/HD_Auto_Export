'use client';

import type { Locale } from '@/i18n/routing';
import { useVehicleFavorites } from '../application/use-vehicle-favorites';
import styles from './favorite-vehicle-button.module.css';

const messages = {
  zh: { save: '收藏车辆', remove: '取消收藏' },
  en: { save: 'Save vehicle', remove: 'Remove from favorites' },
  ru: { save: 'Сохранить автомобиль', remove: 'Удалить из избранного' },
} satisfies Record<Locale, { save: string; remove: string }>;

export function FavoriteVehicleButton({
  vehicleId,
  title,
  locale,
  className = '',
  size = 18,
}: {
  vehicleId: string;
  title: string;
  locale: Locale;
  className?: string;
  size?: number;
}) {
  const { isFavorite, toggle } = useVehicleFavorites();
  const saved = isFavorite(vehicleId);
  const label = `${saved ? messages[locale].remove : messages[locale].save} — ${title}`;
  return (
    <button
      type="button"
      className={`${styles.button} ${className}`}
      data-vehicle-favorite={vehicleId}
      aria-label={label}
      aria-pressed={saved}
      title={label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle(vehicleId);
      }}
    >
      <svg
        aria-hidden="true"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={saved ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
      </svg>
    </button>
  );
}
