import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Empty, Image, Select, Space, Table, Tag, Typography } from 'antd';
import { ExportOutlined, ReloadOutlined } from '@ant-design/icons';
import { PublicVehicleFiltersSchema, PublicVehicleListSchema, LocaleSchema, PowertrainSchema, type PublicVehicle, type PublicVehicleFilters, type PublicVehicleList } from '@hd/contracts/public';
import { request } from '../../shared/api/client';
import { availabilityLabels, formatTime, powertrainLabels } from './draft-form';
import styles from './public-catalog.module.css';

const { Title, Text, Paragraph } = Typography;

/** Inspect exactly what the public HTTP contract exposes, independently of the website. */
export function PublicCatalogPage() {
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<PublicVehicleList | null>(null);
  const [filters, setFilters] = useState<PublicVehicleFilters['data'] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const locale = LocaleSchema.catch('zh').parse(params.get('locale'));
  const make = params.get('make') ?? '';
  const hasOrphanedModel = !make && params.has('model');
  const pageValue = Number(params.get('page') ?? 1);
  const page = !hasOrphanedModel && Number.isInteger(pageValue) && pageValue > 0 && pageValue <= 1_000_000 ? pageValue : 1;
  const model = make ? params.get('model') ?? '' : '';
  const powertrainResult = PowertrainSchema.safeParse(params.get('powertrain'));
  const powertrain = powertrainResult.success ? powertrainResult.data : '';
  useEffect(() => {
    if (!hasOrphanedModel) return;
    const next = new URLSearchParams(params);
    next.delete('model'); next.delete('page');
    setParams(next, { replace: true });
  }, [hasOrphanedModel, params, setParams]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setResult(null);
    const query = new URLSearchParams({ locale, catalog: 'curated', page: String(page), pageSize: '24' });
    if (make) query.set('make', make);
    if (model) query.set('model', model);
    if (powertrain) query.set('powertrain', powertrain);
    Promise.all([
      request(`/api/v1/vehicles?${query}`, PublicVehicleListSchema, { signal: controller.signal }),
      request(`/api/v1/vehicle-filters?catalog=curated&locale=${locale}`, PublicVehicleFiltersSchema, { signal: controller.signal }),
    ]).then(([vehicles, options]) => {
      if (!controller.signal.aborted) { setResult(vehicles); setFilters(options.data); }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '公开车源读取失败。');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [locale, page, make, model, powertrain, refresh]);
  function update(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    if (name !== 'page') next.delete('page');
    if (name === 'make') next.delete('model');
    setParams(next);
  }
  return <section className={styles.page}>
    <div className={styles.heading}><div><Text className={styles.eyebrow}>CATALOG / PUBLIC DATA</Text><Title level={2}>公开车源</Title><Paragraph type="secondary">核对访客可读取的标题、图片、价格与状态。草稿和下架内容不会出现在这里。</Paragraph></div><Button icon={<ReloadOutlined />} loading={loading} onClick={() => setRefresh(current => current + 1)}>重新核验</Button></div>
    <Card>
      <div className={styles.filters}>
        <label><Text strong>展示语言</Text><Select aria-label="展示语言" value={locale} onChange={value => update('locale', value)} options={[{ value: 'zh', label: '中文' }, { value: 'en', label: '英文' }, { value: 'ru', label: '俄文' }]} /></label>
        <label><Text strong>品牌分类</Text><Select aria-label="品牌分类" value={make || undefined} placeholder="全部品牌" allowClear showSearch optionFilterProp="label" onChange={value => update('make', value ?? '')} options={filters?.makes.map(item => ({ value: item.id, label: `${item.name}（${item.count}）` }))} /></label>
        <label><Text strong>车型分类</Text><Select aria-label="车型分类" value={model || undefined} disabled={!make} aria-describedby={!make ? 'model-brand-hint' : undefined} placeholder={make ? '全部车型' : '请先选择品牌'} allowClear showSearch optionFilterProp="label" onChange={value => update('model', value ?? '')} options={filters?.models.filter(item => item.makeId === make).map(item => ({ value: item.id, label: `${item.name}（${item.count}）` }))} /></label>
        <label><Text strong>动力分类</Text><Select aria-label="动力分类" value={powertrain || undefined} placeholder="全部动力" allowClear onChange={value => update('powertrain', value ?? '')} options={filters?.powertrains.map(item => ({ value: item.id, label: `${powertrainLabels[item.id]}（${item.count}）` }))} /></label>
        <Button onClick={() => setParams({})}>清空筛选</Button>
      </div>
      {!make && <Paragraph id="model-brand-hint" type="secondary" className={styles.filterHint}>请先选择品牌，再选择该品牌下的车型。</Paragraph>}
    </Card>
    <Alert type="info" showIcon title="数据口径" description="公开目录包含可展示车辆、展示样例与外部挂牌。样例和外部挂牌保留库存未知，不代表自有现货或库存已核验。" />
    {error && <Alert type="error" showIcon title="公开车源读取失败" description={error} action={<Button onClick={() => setRefresh(current => current + 1)}>重试</Button>} />}
    <Card title={<Space wrap><span>公开目录</span>{result && <Tag>{result.meta.total ?? '未知'} 辆</Tag>}</Space>} extra={result ? <Text type="secondary" className={styles.asOf}>{formatTime(result.meta.dataAsOf)} · {result.meta.freshness === 'fresh' ? '最新读取' : '缓存数据'}</Text> : undefined}>
      <Table<PublicVehicle>
        rowKey="id"
        loading={loading}
        dataSource={result?.data.items ?? []}
        scroll={{ x: 1080 }}
        locale={{ emptyText: error ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="读取失败，请重试" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><strong>没有符合条件的公开车源</strong><br />可调整筛选，或确认车辆已发布。</>} /> }}
        pagination={result ? { current: page, pageSize: 24, total: result.meta.total ?? result.meta.accessibleTotal ?? result.data.items.length, showSizeChanger: false, showTotal: total => `共 ${total} 辆`, onChange: value => update('page', String(value)) } : false}
        columns={[
          { title: '车辆 / 稳定车号', width: 370, render: (_, vehicle) => {
            const cover = vehicle.images.find(item => item.isCover) ?? vehicle.images[0];
            return <Space align="start"><div className={styles.thumbnail}>{cover && <Image src={cover.url} alt={cover.alt || '车辆封面'} width={80} height={58} preview={false} />}</div><Space orientation="vertical" size={3}><Text strong>{vehicle.content.title.text}</Text><Text type="secondary">{vehicle.stockCode}</Text><Text type="secondary">{vehicle.facts.make?.name ?? '未填写'} {vehicle.facts.model?.name ?? ''}</Text></Space></Space>;
          } },
          { title: '公开价格', width: 180, render: (_, vehicle) => <Space orientation="vertical" size={2}><Text strong>{vehicle.price.money ? `${vehicle.price.money.amount} ${vehicle.price.money.currency}` : '待询价'}</Text>{vehicle.price.kind === 'reference' && <Tag color="orange">参考价格</Tag>}</Space> },
          { title: '来源 / 库存', width: 205, render: (_, vehicle) => vehicle.source.kind === 'external' ? <Space orientation="vertical"><Tag color="blue">外部挂牌 · 库存未知</Tag><a href={vehicle.source.listingUrl} target="_blank" rel="noreferrer">{vehicle.source.platform.name} ↗</a><Text type="secondary">采集：{formatTime(vehicle.fetchedAt)}</Text></Space> : String(vehicle.source.kind) === 'demo' ? <Tag color="gold">展示样例，非实际库存</Tag> : <Tag color={vehicle.availability === 'available' ? 'success' : 'default'}>{availabilityLabels[vehicle.availability]}</Tag> },
          { title: '内容审核', width: 160, render: (_, vehicle) => <Space orientation="vertical" size={2}><Text>{vehicle.content.title.contentLocale}</Text><Tag color={vehicle.content.title.reviewed ? 'success' : 'default'}>{vehicle.content.title.reviewed ? '已审核' : '未审核'}</Tag></Space> },
          { title: '核验', width: 130, fixed: 'right', render: (_, vehicle) => <Button type="link" icon={<ExportOutlined />} href={`/api/v1/vehicles/${encodeURIComponent(vehicle.id)}?locale=${locale}`} target="_blank" rel="noreferrer">查看数据</Button> },
        ]}
      />
    </Card>
  </section>;
}
