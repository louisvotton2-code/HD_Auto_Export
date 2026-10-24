import type { CSSProperties } from 'react';

const paths = {
  arrow: 'M4 12h16M14 6l6 6-6 6',
  diagonal: 'M6 18 18 6M6 6h12v12',
  chevron: 'm6 9 6 6 6-6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  car: 'm5 7 2-3h10l2 3 2 3v7h-3v-2H6v2H3v-7l2-3ZM5 7h14M3 11h18M7 12v1m10-1v1',
  box: 'm3 7 9-5 9 5v10l-9 5-9-5V7Zm0 0 9 5 9-5M12 12v10M7.5 4.5l9 5',
  calculator: 'M6 3h12v18H6V3Zm3 4h6M9 11h1m4 0h1m-6 4h1m4 0h1',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v1',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
  refresh: 'M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3',
  copy: 'M9 9h12v12H9V9ZM5 15H3V3h12v2',
  check: 'm5 12 4 4L19 6',
  plus: 'M12 5v14M5 12h14',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2',
  spark: 'm12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z',
  menu: 'M4 7h16M4 12h16M4 17h16',
};

export function Icon({
  name,
  size = 20,
  className,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
