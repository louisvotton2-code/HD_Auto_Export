import { useState } from 'react';
import { Alert, Button, Card, Empty, Input, Pagination, Radio, Segmented, Space, Spin, Typography } from 'antd';
import { AdminVehicleListSchema, ExternalListingListResponseSchema } from '@hd/contracts/admin';
import { usePrivateResource } from '../../shared/api/use-private-resource';
import { externalRoot } from '../external-sources/external-labels';
import { EnabledPixelVehicles } from './enabled-pixel-vehicles';
import { VehiclePixelSettings, type PixelVehicle } from './vehicle-pixel-settings';
import styles from './vehicle-pixel-page.module.css';

const pageSize = 12;
const sources = [
  { label: '自录车', value: 'manual' },
  { label: '第三方车', value: 'external' },
] as const;
const views = [
  { label: '已开启', value: 'enabled' },
  { label: '查找车辆', value: 'search' },
] as const;
type View = typeof views[number]['value'];

export function VehiclePixelPage() {
  const [view, setView] = useState<View>('enabled');
  const [source, setSource] = useState<PixelVehicle['source']>('manual');
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [listRevision, setListRevision] = useState(0);
  const [enabledRevision, setEnabledRevision] = useState(0);
  const [selected, setSelected] = useState<PixelVehicle | null>(null);
  const [saving, setSaving] = useState(false);
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (search) query.set('q', search);
  const manual = usePrivateResource(view === 'search' && source === 'manual' ? `/api/v1/admin/vehicles?${query}&deleted=exclude` : null,
    AdminVehicleListSchema, listRevision, 12_000);
  const external = usePrivateResource(view === 'search' && source === 'external' ? `${externalRoot}/listings?${query}&state=published&locale=zh` : null,
    ExternalListingListResponseSchema, listRevision, 12_000);
  const list = source === 'manual' ? manual : external;
  const total = list.data?.data.total ?? 0;
  const candidates: PixelVehicle[] = source === 'manual'
    ? (manual.data?.data.items ?? []).filter(row => row.draft.source.kind === 'manual' && !row.deletedAt).map(row => ({
      id: row.id, code: row.stockCode, source: 'manual',
      title: row.draft.content.title.sourceText || [row.draft.facts.make?.name, row.draft.facts.model?.name].filter(Boolean).join(' ') || row.stockCode,
    }))
    : (external.data?.data.items ?? []).filter(row => row.state === 'published').map(row => ({
      id: row.id, code: row.inquiryCode ?? row.id, source: 'external',
      title: row.title ?? row.facts?.model?.name ?? row.externalId,
    }));

  function chooseSource(next: PixelVehicle['source']) {
    if (next === source || saving) return;
    setSource(next);
    setKeyword('');
    setSearch('');
    setPage(1);
    setSelected(null);
    manual.resume();
    external.resume();
  }

  function chooseView(next: View) {
    if (next === view || saving) return;
    setView(next);
    setSelected(null);
    manual.resume();
    external.resume();
  }

  function searchVehicles(value: string) {
    if (saving) return;
    setSearch(value.trim());
    setPage(1);
    setSelected(null);
    list.resume();
    setListRevision(revision => revision + 1);
  }

  return <section aria-labelledby="vehicle-pixel-heading">
    <div className="page-heading">
      <div>
        <Typography.Title id="vehicle-pixel-heading" level={1}>Pixel 推广</Typography.Title>
        <p>在此查看已开启的车辆，或查找车辆并设置 Facebook Pixel。</p>
      </div>
    </div>
    <Segmented aria-label="推广管理范围" className={styles.views} options={[...views]} value={view} onChange={chooseView} disabled={saving} />
    <div className={styles.layout}>
      {view === 'enabled' ? <EnabledPixelVehicles selectedId={selected?.id} onSelect={setSelected} saving={saving}
        revision={enabledRevision} onFind={() => chooseView('search')} /> : <Card title="选择车辆">
        <Space orientation="vertical" size="middle" className={styles.fullWidth}>
          <Segmented aria-label="车辆来源" options={[...sources]} value={source} onChange={chooseSource} disabled={saving} />
          <Input.Search aria-label="搜索车辆" placeholder="输入车辆编号、品牌、车型或标题" enterButton="搜索"
            allowClear maxLength={100} disabled={saving} value={keyword} onChange={event => setKeyword(event.target.value)} onSearch={searchVehicles} />
          {list.loading && <Spin description="正在查找车辆…" />}
          {list.error && <Alert type="error" showIcon title="车辆列表读取失败" description={list.error}
            action={<Button size="small" onClick={() => searchVehicles(search)}>重新读取</Button>} />}
          {list.data && (candidates.length ? <Radio.Group aria-label="选择车辆" value={selected?.id} disabled={saving}
            onChange={event => setSelected(candidates.find(row => row.id === event.target.value) ?? null)} className={styles.choices}>
            {candidates.map(row => <Radio key={row.id} value={row.id} className={styles.vehicle}>
              <Typography.Text strong>{row.title}</Typography.Text>
              {row.code !== row.title && <Typography.Text type="secondary" className={styles.vehicleCode}>{row.code}</Typography.Text>}
            </Radio>)}
          </Radio.Group> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={total > pageSize ? '本页暂无可选车辆，可搜索或翻页。' : '暂无匹配的可选车辆。'} />)}
          {total > pageSize && <Pagination current={page} pageSize={pageSize} total={total} size="small" disabled={saving}
            showSizeChanger={false} onChange={next => { setPage(next); setSelected(null); }} />}
        </Space>
      </Card>}
      {selected ? <VehiclePixelSettings key={selected.id} vehicle={selected} onSaving={setSaving} fromEnabledList={view === 'enabled'}
        onRefreshIndex={() => setEnabledRevision(value => value + 1)} /> : <Card title="Facebook Pixel">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择一辆车查看当前设置。" />
      </Card>}
    </div>
  </section>;
}
