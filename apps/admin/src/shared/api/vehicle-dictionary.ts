import { useEffect, useState } from 'react';
import { AdminVehicleFiltersResponseSchema, type AdminVehicleFiltersResponse } from '@hd/contracts/admin';
import { request } from './client';

/** Staff dictionaries include unpublished drafts, unlike public catalog filters. */
export function useVehicleDictionary() {
  const [data, setData] = useState<AdminVehicleFiltersResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    request('/api/v1/admin/vehicle-filters', AdminVehicleFiltersResponseSchema, { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setData(response.data); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '品牌车型字典读取失败'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  return { data, loading, error, reload: () => setRevision(value => value + 1) };
}
