import { useState } from 'react';
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, Card, Descriptions, Select, Space, Tag, Typography } from 'antd';
import { ExternalListingResponseSchema, LocaleSchema, type ExternalListing, type Locale, type StaffMe } from '@hd/contracts/admin';
import { externalRoot, fieldLabels, issueLabels, languageLabels, listingLabels, platformName } from './external-labels';
import { ListingOverrideEditor } from './listing-override-editor';
import { ResourceContent } from './resource-content';
import { SourceRecordDetails } from './source-record-details';
import { useExternalResource } from './use-external-resource';
import styles from './external-sources.module.css';

const fields = ['title', 'model', 'description'] as const;
const locales = ['zh', 'en', 'ru'] as const;

function ListingContent({ listing, locale, changeLocale, reload }: {
  listing: ExternalListing; locale: Locale; changeLocale: (locale: Locale) => void; reload: () => void;
}) {
  const staff = useOutletContext<StaffMe>();
  const [editing, setEditing] = useState(false);
  const vehicle = listing.vehicle;
  const source = listing.source;
  const publicCopy = {
    title: vehicle?.content.title,
    model: vehicle?.display?.model,
    description: vehicle?.content.description,
  };
  return <>
    <Card title="当前挂牌">
      <Space wrap>
        <Tag>{listingLabels[listing.state]}</Tag>
        <span className={styles.reason}>站内车源 ID {listing.id}</span>
        <span>来源版本 {listing.sourceRevision}</span>
        <span>管理版本 {listing.version}</span>
        <Button onClick={reload} disabled={editing}>重新读取</Button>
        {listing.state !== 'withdrawn' && staff.permissions.includes('vehicles:write') &&
          <Button type="primary" onClick={() => setEditing(true)}>人工修订</Button>}
      </Space>
      <Typography.Paragraph type="secondary" className={styles.sourceText}>公开展示优先采用人工修订，并遵循来源冲突与撤回规则。</Typography.Paragraph>
    </Card>
    <SourceRecordDetails
      source={platformName(listing.identity.platformId)}
      identity={listing.identity.externalId}
      listingUrl={source?.listingUrl ?? null}
      comparisons={fields.map(field => ({
        key: field, label: fieldLabels[field], original: source?.copy[field]?.original.text ?? null,
        translations: locales.map(language => {
          const manual = listing.overrides.text.find(item => item.field === field && item.locale === language);
          const supplier = source?.copy[field]?.translations[language];
          const sourceHash = listing.sourceHashes[field];
          let status = supplier ? '供应商译文' : undefined;
          if (manual) {
            status = '人工修订';
            if (manual.sourceHash !== sourceHash) {
              const published = publicCopy[field];
              const matchesManual = language === locale && published?.requestedLocale === locale
                && published.contentLocale === locale && published.text === manual.text
                && ('kind' in published ? published.kind === 'human' : published.provenance === 'human');
              status = matchesManual ? '原文有更新，当前仍使用人工修订，请核对' : '原文有更新，人工修订待核对';
            }
          }
          return { language: languageLabels[language], text: manual?.text ?? supplier?.text ?? null, status };
        }),
      }))}
      conflicts={[
        ...(source?.disputes ?? []).map(field => ({
          key: field, label: fieldLabels[field], reason: Object.hasOwn(listing.overrides.facts, field)
            ? '来源有冲突，当前使用人工修订。' : '来源有冲突，请核对来源值。',
        })),
        ...(vehicle?.external?.issues ?? []).filter(issue => !source?.disputes.some(field => field === issue.field)).map(issue => ({
          key: `${issue.field}:${issue.code}`, label: fieldLabels[issue.field], reason: issueLabels[issue.code],
        })),
      ]}
    />
    <Card title="公开展示核对" extra={<Select aria-label="公开展示语言" value={locale} onChange={changeLocale} disabled={editing}
      options={Object.entries(languageLabels).map(([value, label]) => ({ value, label }))} />}>
      {vehicle ? <Descriptions size="small" column={1} items={[
        { key: 'title', label: '标题', children: <div className={styles.sourceText}>{vehicle.content.title.text} <Tag>{vehicle.content.title.contentLocale}</Tag></div> },
        { key: 'model', label: '车型', children: vehicle.display?.model.text ? <div className={styles.sourceText}>{vehicle.display.model.text} <Tag>{vehicle.display.model.contentLocale}</Tag></div> : '暂无展示值' },
        { key: 'description', label: '描述', children: vehicle.content.description ? <div className={styles.sourceText}>{vehicle.content.description.text} <Tag>{vehicle.content.description.contentLocale}</Tag></div> : '暂无展示值' },
        { key: 'price', label: '参考价', children: vehicle.price.money ? `${vehicle.price.money.amount} ${vehicle.price.money.currency}` : '待询价' },
      ]} /> : <Alert type="info" title="此挂牌暂无公开展示快照。" />}
    </Card>
    {editing && <ListingOverrideEditor listing={listing} onClose={() => setEditing(false)}
      onRefresh={() => { setEditing(false); reload(); }} />}
  </>;
}

export function ExternalListingPage() {
  const location = useLocation();
  const catalogSearch: unknown = location.state?.catalogSearch;
  const { listingId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const locale = LocaleSchema.catch('zh').parse(params.get('locale'));
  const resource = useExternalResource(`${externalRoot}/listings/${encodeURIComponent(listingId)}?locale=${locale}`, ExternalListingResponseSchema);
  return <section className={styles.stack}>
    <Space wrap>
      <Link to={{ pathname: '/public-catalog', search: typeof catalogSearch === 'string' ? catalogSearch : '' }}>返回三方车源管理</Link>
      <Link to="/external-sources/batches">历史导入批次</Link>
    </Space>
    <Typography.Title level={2}>外部挂牌详情</Typography.Title>
    <ResourceContent {...resource} retry={resource.reload}>{resource.data && (
      resource.data.data.id === listingId
        ? <ListingContent key={`${listingId}:${resource.data.data.version}`} listing={resource.data.data}
          locale={locale} changeLocale={next => setParams({ locale: next }, { replace: true, state: location.state })} reload={resource.reload} />
        : <Alert type="error" title="服务返回的挂牌编号与当前页面不一致。" />
    )}</ResourceContent>
  </section>;
}
