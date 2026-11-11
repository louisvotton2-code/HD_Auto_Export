import { useEffect } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Card, Input, Space, Table, Tag, Typography } from 'antd';
import { ExternalListingListResponseSchema } from '@hd/contracts/admin';
import { ExternalHttpsUrlSchema } from '@hd/contracts/public';
import { externalRoot, listingLabels, pageSize, platformName } from './external-labels';
import { ResourceContent } from './resource-content';
import { useExternalResource } from './use-external-resource';
import styles from './external-sources.module.css';

export function ExternalCatalogPage() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.replaceAll('\0', '').trim().slice(0, 2048) ?? '';
  const pageValue = Number(params.get('page') ?? 1);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 && pageValue <= 1_000_000 ? pageValue : 1;
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) query.set('q', q);
  const resource = useExternalResource(`${externalRoot}/listings?${query}`, ExternalListingListResponseSchema);
  const result = resource.data?.data;
  const lastPage = result ? Math.max(1, Math.ceil(result.total / pageSize)) : page;
  const needsPageCorrection = page > lastPage;

  useEffect(() => {
    if (!needsPageCorrection) return;
    const updated = new URLSearchParams(params);
    if (lastPage > 1) updated.set('page', String(lastPage)); else updated.delete('page');
    setParams(updated, { replace: true });
  }, [lastPage, needsPageCorrection, params, setParams]);

  function search(value: string) {
    const next = value.replaceAll('\0', '').trim();
    setParams(next ? { q: next } : {});
  }

  function changePage(next: number) {
    const updated = new URLSearchParams(params);
    if (next > 1) updated.set('page', String(next)); else updated.delete('page');
    setParams(updated);
  }

  return <section className={styles.stack}>
    <header className={styles.heading}>
      <Typography.Title level={2}>三方车源管理</Typography.Title>
      <Space wrap>
        <Link to="/external-sources">三方 API 状态</Link>
        <Link to="/public-catalog/verification">公开车源核验</Link>
      </Space>
    </header>
    <Card>
      <Typography.Paragraph id="external-search-hint" type="secondary">
        可按站内车源 ID、原平台 ID、原始 URL 或车型标题搜索。
      </Typography.Paragraph>
      <Input.Search
        key={q}
        defaultValue={q}
        aria-label="搜索三方车源"
        aria-describedby="external-search-hint"
        placeholder="输入车源关键词"
        maxLength={2048}
        enterButton="搜索"
        allowClear
        onSearch={search}
      />
    </Card>
    <Card>
      <ResourceContent {...resource} loading={resource.loading || needsPageCorrection} retry={resource.reload}>
        {result && <Table
          rowKey="id"
          scroll={{ x: 800 }}
          dataSource={result.items}
          locale={{ emptyText: '没有符合条件的三方车源' }}
          pagination={{
            current: page, pageSize, total: result.total, showSizeChanger: false,
            showTotal: total => `共 ${total} 条`, onChange: changePage,
          }}
          columns={[
            { title: '车型 / 站内车源 ID', width: 270, render: (_, listing) => <div className={styles.reason}>
              <Link to={`/external-sources/listings/${encodeURIComponent(listing.id)}`} state={{ catalogSearch: location.search }}>
                {listing.title ?? listing.id}
              </Link>
              {listing.title && <div><Typography.Text type="secondary">{listing.id}</Typography.Text></div>}
            </div> },
            { title: '来源平台 / 原平台 ID', width: 240, render: (_, listing) => <div className={styles.reason}>
              <div>{platformName(listing.platformId)}</div>
              <Typography.Text type="secondary">{listing.externalId}</Typography.Text>
            </div> },
            { title: '状态', render: (_, listing) => <Tag>{listingLabels[listing.state]}</Tag> },
            { title: '人工修订', render: (_, listing) => listing.hasOverrides ? <Tag color="gold">已修订</Tag> : '—' },
            { title: '原始挂牌', render: (_, listing) => {
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
