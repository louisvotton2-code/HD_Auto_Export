import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Button, Card, Input, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import { ExternalListingListQuerySchema, ExternalListingListResponseSchema, ExternalListingOverviewResponseSchema } from '@hd/contracts/admin';
import { ExternalHttpsUrlSchema } from '@hd/contracts/public';
import { powertrainLabels } from '../vehicles/draft-form';
import { externalRoot, listingLabels, pageSize, platformName } from './external-labels';
import { ResourceContent } from './resource-content';
import { useExternalResource } from './use-external-resource';
import styles from './external-sources.module.css';

const filterSchema = ExternalListingListQuerySchema.shape;
const stateOptions = Object.entries(listingLabels).map(([value, label]) => ({ value, label }));
const powertrainOptions = Object.entries(powertrainLabels).map(([value, label]) => ({ value, label }));
const mileageOptions = [10_000, 30_000, 50_000, 100_000, 150_000].map(value => ({
  value: String(value), label: `${value.toLocaleString('zh-CN')} 公里以内`,
}));

export function ExternalCatalogPage() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [searchReset, setSearchReset] = useState(0);
  const q = params.get('q')?.replaceAll('\0', '').trim().slice(0, 2048) ?? '';
  const make = filterSchema.make.safeParse(params.get('make')).data;
  const model = make ? filterSchema.model.safeParse(params.get('model')).data : undefined;
  const platform = filterSchema.platformId.safeParse(params.get('platformId')).data;
  const state = filterSchema.state.safeParse(params.get('state')).data;
  const powertrain = filterSchema.powertrain.safeParse(params.get('powertrain')).data;
  const year = filterSchema.yearMin.safeParse(Number(params.get('year') ?? NaN)).data;
  const mileage = filterSchema.mileageMax.safeParse(Number(params.get('mileageMax') || NaN)).data;
  const page = filterSchema.page.safeParse(Number(params.get('page') ?? 1)).data ?? 1;
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  for (const [key, value] of Object.entries({ q, make, model, platformId: platform, state, powertrain, yearMin: year, yearMax: year, mileageMax: mileage })) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const overviewQuery = make ? `?make=${encodeURIComponent(make)}` : '';
  const overview = useExternalResource(`${externalRoot}/listings/overview${overviewQuery}`, ExternalListingOverviewResponseSchema);
  const resource = useExternalResource(`${externalRoot}/listings?${query}`, ExternalListingListResponseSchema);
  const stats = overview.data?.data;
  const result = resource.data?.data;
  const lastPage = result ? Math.max(1, Math.ceil(result.total / pageSize)) : page;
  const needsPageCorrection = page > lastPage;

  useEffect(() => {
    if (!needsPageCorrection) return;
    const updated = new URLSearchParams(params);
    if (lastPage > 1) updated.set('page', String(lastPage)); else updated.delete('page');
    setParams(updated, { replace: true });
  }, [lastPage, needsPageCorrection, params, setParams]);

  function update(name: string, value: string | undefined) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value); else next.delete(name);
    if (name !== 'page') next.delete('page');
    if (name === 'make') next.delete('model');
    setParams(next);
  }

  return <section className={styles.stack}>
    <header className={styles.heading}>
      <div>
        <Typography.Title level={2}>三方车源管理</Typography.Title>
        <Typography.Text type="secondary">按入库资料和人工修订筛选，进入详情核对公开展示。</Typography.Text>
      </div>
      <Link to="/public-catalog/verification">公开车源核验</Link>
    </header>
    <section aria-label="车源概览" className={styles.stats}>
      {([
        ['入库挂牌', stats?.total],
        ['已展示', stats?.published],
        ['人工隐藏', stats?.hidden],
        ['来源撤回', stats?.withdrawn],
      ] as const).map(([title, count]) => <Card key={title} size="small">
        <Statistic title={title} value={count ?? '—'} loading={overview.loading} />
      </Card>)}
      <Card size="small" className={styles.exportStatus}>
        <Statistic title="出口资格" value="待核验" />
        <Typography.Text type="secondary">暂无逐车核验数据</Typography.Text>
      </Card>
    </section>
    {overview.error && <ResourceContent {...overview} retry={overview.reload}>{null}</ResourceContent>}
    <Card title="筛选车源" extra={<Button type="link" onClick={() => {
      setSearchReset(value => value + 1);
      setParams({});
    }}>清空筛选</Button>}>
      <Input.Search
        key={`${q}:${searchReset}`}
        defaultValue={q}
        aria-label="搜索三方车源"
        placeholder="输入站内 ID、原平台 ID、原始 URL 或车型标题"
        maxLength={2048}
        enterButton="搜索"
        allowClear
        onSearch={value => update('q', value.replaceAll('\0', '').trim())}
      />
      <div className={styles.filters}>
        <label>来源平台<Select aria-label="来源平台" allowClear placeholder="全部平台" value={platform}
          options={stats?.platforms.map(value => ({ value, label: platformName(value) }))} onChange={value => update('platformId', value)} /></label>
        <label>挂牌状态<Select aria-label="挂牌状态" allowClear placeholder="全部状态" value={state}
          options={stateOptions} onChange={value => update('state', value)} /></label>
        <label>品牌<Select aria-label="品牌" allowClear showSearch={{ optionFilterProp: 'label' }} placeholder="全部品牌" value={make}
          options={stats?.makes.map(({ id, name }) => ({ value: id, label: name }))} onChange={value => update('make', value)} /></label>
        <label>车型<Select aria-label="车型" allowClear showSearch={{ optionFilterProp: 'label' }} disabled={!make}
          placeholder={make ? '全部车型' : '请先选品牌'} value={model}
          options={stats?.models.map(({ id, name }) => ({ value: id, label: name }))} onChange={value => update('model', value)} /></label>
        <label>动力类型<Select aria-label="动力类型" allowClear placeholder="全部动力" value={powertrain}
          options={powertrainOptions} onChange={value => update('powertrain', value)} /></label>
        <label>年款<Select aria-label="年款" allowClear placeholder="全部年款" value={year?.toString()}
          options={stats?.years.map(value => ({ value: String(value), label: `${value} 款` }))} onChange={value => update('year', value)} /></label>
        <label>里程上限<Select aria-label="里程上限" allowClear placeholder="不限里程" value={mileage?.toString()}
          options={mileageOptions} onChange={value => update('mileageMax', value)} /></label>
      </div>
    </Card>
    <Card title="挂牌结果" extra={result && !needsPageCorrection ? <Tag>{result.total.toLocaleString('zh-CN')} 条匹配</Tag> : undefined}>
      <ResourceContent {...resource} loading={resource.loading || needsPageCorrection} retry={resource.reload}>
        {result && <Table
          rowKey="id"
          scroll={{ x: 900 }}
          dataSource={result.items}
          locale={{ emptyText: '没有符合条件的三方车源' }}
          pagination={{
            current: page, pageSize, total: result.total, showSizeChanger: false,
            showTotal: total => `共 ${total} 条`, onChange: next => update('page', next > 1 ? String(next) : undefined),
          }}
          columns={[
            { title: '车辆', width: 290, render: (_, listing) => <div className={styles.reason}>
              <Link className={styles.listingTitle} to={`/external-sources/listings/${encodeURIComponent(listing.id)}`} state={{ catalogSearch: location.search }}>
                {listing.title ?? listing.facts?.model?.name ?? listing.id}
              </Link>
              <div><Typography.Text type="secondary">{listing.id}</Typography.Text></div>
            </div> },
            { title: '入库参数', width: 155, render: (_, { facts }) => facts
              ? <div>{facts.modelYear ? `${facts.modelYear} 款` : '年款未知'} · {powertrainLabels[facts.powertrain]}
                <div>{facts.mileageKm !== null ? `${facts.mileageKm.toLocaleString('zh-CN')} 公里` : '里程未知'}</div>
              </div> : '暂无参数' },
            { title: '来源平台', width: 145, render: (_, listing) => <div className={styles.reason}>
              <div>{platformName(listing.platformId)}</div>
              <Typography.Text type="secondary">{listing.externalId}</Typography.Text>
            </div> },
            { title: '挂牌状态', width: 140, render: (_, listing) => <Space size={[0, 4]} wrap>
              <Tag color={listing.state === 'published' ? 'success' : undefined}>{listingLabels[listing.state]}</Tag>
              {listing.hasOverrides && <Tag color="gold">已修订</Tag>}
            </Space> },
            { title: '原始挂牌', width: 120, render: (_, listing) => {
              const link = ExternalHttpsUrlSchema.safeParse(listing.listingUrl);
              return link.success
                ? <a href={link.data} target="_blank" rel="noopener noreferrer">访问原站</a>
                : '无可用链接';
            } },
          ]}
        />}
      </ResourceContent>
    </Card>
  </section>;
}
