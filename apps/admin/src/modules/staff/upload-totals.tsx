import { useEffect, useState } from 'react';
import { Tooltip } from 'antd';
import { StaffUploadStatsResponseSchema } from '@hd/contracts/admin';
import { usePrivateResource } from '../../shared/api/use-private-resource';

const day = 24 * 60 * 60 * 1000;
const beijingOffset = 8 * 60 * 60 * 1000;

export function UploadTotals({ staffId }: { staffId: string }) {
  const [revision, setRevision] = useState(0);
  const resource = usePrivateResource('/api/v1/admin/me/upload-stats', StaffUploadStatsResponseSchema, revision);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    let timer: number;
    function scheduleNextDay() {
      const elapsed = (Date.now() + beijingOffset) % day;
      timer = window.setTimeout(() => {
        refresh();
        scheduleNextDay();
      }, day - elapsed);
    }
    scheduleNextDay();
    window.addEventListener('admin:vehicle-created', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('admin:vehicle-created', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const stats = resource.data?.data;
  const identityChanged = Boolean(stats && stats.staffId !== staffId);
  useEffect(() => {
    if (identityChanged) window.dispatchEvent(new Event('admin:unauthorized'));
  }, [identityChanged]);
  const ownStats = identityChanged ? undefined : stats;
  const todayColor = ownStats ? (ownStats.today < 10 ? ' staff-upload-below-target' : ' staff-upload-target-met') : '';
  return <Tooltip title={resource.error ? '上传统计暂不可用，可刷新页面后重试。' : '今日按北京时间统计'}>
    <div className="staff-upload-totals" role="group" aria-label="我的上传统计">
      <span>今日上传 <strong className={`staff-upload-today${todayColor}`}>{ownStats?.today ?? '—'}</strong></span>
      <span>累计上传 <strong>{ownStats?.total ?? '—'}</strong></span>
    </div>
  </Tooltip>;
}
