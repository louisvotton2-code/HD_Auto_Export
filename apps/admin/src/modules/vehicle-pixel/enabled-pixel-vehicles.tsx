import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Pagination, Radio, Space, Spin, Tag, Typography } from 'antd';
import { EnabledPixelVehiclesResponseSchema } from '@hd/contracts/admin';
import { ExternalListingIdSchema } from '@hd/contracts/public';
import { usePrivateResource } from '../../shared/api/use-private-resource';
import type { PixelVehicle } from './vehicle-pixel-settings';
import styles from './vehicle-pixel-page.module.css';

const pageSize = 12;

export function EnabledPixelVehicles({ selectedId, onSelect, saving, revision, onFind }: {
  selectedId?: string;
  onSelect: (vehicle: PixelVehicle | null) => void;
  saving: boolean;
  revision: number;
  onFind: () => void;
}) {
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const list = usePrivateResource(`/api/v1/admin/vehicle-pixel/enabled?page=${page}&pageSize=${pageSize}`,
    EnabledPixelVehiclesResponseSchema, `${revision}:${reload}`, 12_000);
  const previousRevision = useRef(revision);
  const { resume } = list;
  useEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    resume();
  }, [revision, resume]);
  const data = list.data?.data;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / pageSize)) : page;
  useEffect(() => {
    if (page > lastPage) setPage(lastPage);
  }, [lastPage, page]);
  const vehicles: PixelVehicle[] = (data?.items ?? []).map(row => ({
    id: row.vehicleId, code: row.code, title: row.title,
    source: ExternalListingIdSchema.safeParse(row.vehicleId).success ? 'external' : 'manual',
  }));
  const error = list.errorStatus === 404
    ? `当前后台接口尚未提供已开启列表。请联系维护人员核对接口版本。${list.errorRequestId ? `（参考编号：${list.errorRequestId}）` : ''}`
    : list.error;

  return <Card title="已开启的车辆" extra={data && <Typography.Text type="secondary">共 {data.total} 辆</Typography.Text>}>
    <Space orientation="vertical" size="middle" className={styles.fullWidth}>
      {list.loading && <Spin description="正在读取已开启的车辆…" />}
      {error && <Alert type="error" showIcon title="已开启列表读取失败" description={error}
        action={<Button size="small" onClick={() => { list.resume(); setReload(value => value + 1); }}>重新读取</Button>} />}
      {data && page <= lastPage && (vehicles.length ? <Radio.Group aria-label="已开启的车辆" value={selectedId} disabled={saving}
        onChange={event => onSelect(vehicles.find(row => row.id === event.target.value) ?? null)} className={styles.choices}>
        {vehicles.map(vehicle => <Radio key={vehicle.id} value={vehicle.id} className={styles.vehicle}>
          <Typography.Text strong>{vehicle.title}</Typography.Text>
          <Typography.Text type="secondary" className={styles.vehicleCode}>
            {vehicle.source === 'manual' ? '自录车' : '第三方车'}{vehicle.code === vehicle.title ? '' : ` · ${vehicle.code}`}
          </Typography.Text>
        </Radio>)}
      </Radio.Group> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无启用 Pixel 的车辆。">
        <Button onClick={onFind}>查找车辆</Button>
      </Empty>)}
      {data && lastPage > 1 && <Pagination current={page} pageSize={pageSize} total={data.total} size="small" disabled={saving}
        showSizeChanger={false} onChange={next => { setPage(next); onSelect(null); }} />}
    </Space>
  </Card>;
}
