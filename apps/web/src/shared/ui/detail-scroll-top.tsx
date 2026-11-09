'use client';

import { useEffect } from 'react';

/** A detail route always starts at its heading, even if Next keeps the prior scroll offset. */
export function DetailScrollTop({ path }: { path: string }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [path]);
  return null;
}
