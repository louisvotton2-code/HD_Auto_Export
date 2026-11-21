import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Radio, Segmented, Spin, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { AnalyticsOverviewResponseSchema, type AnalyticsDays } from '@hd/contracts/analytics';
import { usePrivateResource } from '../../shared/api/use-private-resource';
import { AccessDenied } from '../auth';
import { SiteAnalyticsContent, type AnalyticsMetric } from './site-analytics-content';
import { SiteAnalyticsV2 } from './site-analytics-v2';
import { SiteTrafficPage } from './site-traffic-page';
import styles from './site-analytics.module.css';

const periods: { label: string; value: AnalyticsDays }[] = [{ label: '近 7 天', value: 7 }, { label: '近 30 天', value: 30 }];
type RangeRequest = { days: AnalyticsDays; revision: number };

function LegacySiteAnalyticsPage() {
  const [days, setDays] = useState<AnalyticsDays>(30);
  const [requested, setRequested] = useState<RangeRequest>({ days: 30, revision: 0 });
  const [metric, setMetric] = useState<AnalyticsMetric>('pageViews');
  const resource = usePrivateResource(`/api/v1/admin/analytics/overview?days=${requested.days}`, AnalyticsOverviewResponseSchema, requested.revision, 12_000);
  const waiting = days !== requested.days;
  const sessionExpired = resource.errorStatus === 401;
  const denied = resource.errorStatus === 403;
  const loading = !sessionExpired && (resource.loading || waiting);
  const overview = resource.data?.data;
  const error = resource.error ?? (overview && overview.days !== requested.days ? '服务返回的统计日期范围与当前选择不一致。' : undefined);

  useEffect(() => {
    if (!waiting || resource.loading || sessionExpired || denied) return;
    // The API permits one active read. Let it settle before sending the most recent selection.
    setRequested(current => ({ days, revision: current.revision + 1 }));
  }, [days, waiting, resource.loading, sessionExpired, denied]);

  function reload() {
    setRequested(current => ({ days, revision: current.revision + 1 }));
    resource.resume();
  }

  if (denied) return <AccessDenied>当前账号没有查看网站分析的权限。</AccessDenied>;

  return <section className={styles.page} aria-labelledby="site-analytics-heading">
    <header className={styles.heading}>
      <h1 id="site-analytics-heading">网站分析</h1>
      <div className={styles.controls}>
        <Radio.Group value={days} onChange={event => setDays(event.target.value)} aria-label="统计日期范围"
          optionType="button" options={periods} />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>刷新</Button>
      </div>
    </header>
    <Typography.Text type="secondary">此处保留历史统计。当前访问量和联系点击请查看「官网流量」。</Typography.Text>
    {loading && <Spin description="正在读取网站分析…" />}
    {!loading && error && <Alert type="error" showIcon title="网站分析读取失败" description={error} />}
    {!loading && overview && !error && <SiteAnalyticsContent data={overview} metric={metric} onMetricChange={setMetric} />}
  </section>;
}

function SessionAnalyticsPage() {
  const [legacy, setLegacy] = useState(false);
  const useLegacy = useCallback(() => setLegacy(true), []);
  return legacy ? <LegacySiteAnalyticsPage /> : <SiteAnalyticsV2 onUnavailable={useLegacy} />;
}

export function SiteAnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const active = params.get('view') === 'sessions' ? 'sessions' : 'traffic';
  return <>
    <nav className={styles.modeNav} aria-label="网站分析口径">
      <Segmented<'traffic' | 'sessions'> aria-label="统计口径" value={active}
        options={[{ value: 'traffic', label: '官网流量' }, { value: 'sessions', label: '访客行为' }]}
        onChange={value => setParams(current => {
          const next = new URLSearchParams(current);
          if (value === 'sessions') next.set('view', value);
          else next.delete('view');
          return next;
        })} />
    </nav>
    {active === 'traffic' ? <SiteTrafficPage /> : <SessionAnalyticsPage />}
  </>;
}
