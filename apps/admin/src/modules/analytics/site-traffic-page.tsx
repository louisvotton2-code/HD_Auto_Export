import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Spin, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { AnalyticsTrafficResponseSchema } from '@hd/contracts/analytics';
import { usePrivateResource } from '../../shared/api/use-private-resource';
import { AccessDenied } from '../auth';
import { matchesReportDates, presetDates, type AnalyticsPeriod, type DateRange, type RangePreset } from './analytics-range';
import { reportTime } from './v2-report-model';
import { V2RangeControls } from './v2-range-controls';
import { TrafficView, type TrafficMetric, type TrafficViewProps } from './traffic-view';
import { trafficPageSize, trafficQuery, trafficViewData } from './traffic-report-model';
import styles from './site-analytics.module.css';

type RankMetric = TrafficViewProps['ranking']['metric'];

export function SiteTrafficPage({ period: { preset, days }, onPeriodChange }: {
  period: AnalyticsPeriod; onPeriodChange: (period: AnalyticsPeriod) => void;
}) {
  const [custom, setCustom] = useState(days);
  const [rank, setRank] = useState<{ metric: RankMetric; page: number }>({ metric: 'contactClicks', page: 1 });
  const [trendMetric, setTrendMetric] = useState<TrafficMetric>('uniqueIpVisits');
  const query = trafficQuery(days, rank.metric, rank.page);
  const path = `/api/v1/admin/analytics/traffic?${new URLSearchParams(query)}`;
  const [request, setRequest] = useState({ path, revision: 0 });
  const resource = usePrivateResource(request.path, AnalyticsTrafficResponseSchema, request.revision, 12_000);
  const waiting = request.path !== path;
  const expired = resource.errorStatus === 401;
  const denied = resource.errorStatus === 403;
  const loading = !expired && (waiting || resource.loading);
  const report = !loading ? resource.data?.data : undefined;
  const view = useMemo(() => report && trafficViewData(report), [report]);
  const matches = !view || (matchesReportDates(view.range, days)
    && view.interval === query.granularity && view.ranking.metric === rank.metric && view.ranking.page === rank.page && view.ranking.pageSize === trafficPageSize);

  useEffect(() => {
    if (!waiting || resource.loading || expired || denied) return;
    setRequest(current => ({ path, revision: current.revision + 1 }));
  }, [path, waiting, resource.loading, expired, denied]);

  useEffect(() => {
    if (!view || !matches) return;
    const lastPage = Math.max(1, Math.ceil(view.ranking.total / view.ranking.pageSize));
    if (rank.page > lastPage) setRank(current => ({ ...current, page: lastPage }));
  }, [view, matches, rank.page]);

  useEffect(() => {
    if (preset === 'custom') return;
    const currentPreset = preset;
    function followBeijingDate() {
      const next = presetDates(currentPreset);
      if (next.from !== days.from || next.to !== days.to) applyRange(next);
    }
    const timer = window.setInterval(followBeijingDate, 30_000);
    window.addEventListener('focus', followBeijingDate);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', followBeijingDate); };
  }, [preset, days, onPeriodChange]);

  function applyRange(range: DateRange, nextPreset: RangePreset = preset) {
    onPeriodChange({ preset: nextPreset, days: range });
    setRank(current => ({ ...current, page: 1 }));
  }

  function selectPreset(value: RangePreset) {
    if (value === 'custom') { setCustom(days); onPeriodChange({ preset: value, days }); return; }
    applyRange(presetDates(value), value);
  }

  function reload() {
    resource.resume();
    if (preset !== 'custom') {
      const next = presetDates(preset);
      if (next.from !== days.from || next.to !== days.to) { applyRange(next); return; }
    }
    setRequest(current => ({ path, revision: current.revision + 1 }));
  }

  if (denied) return <AccessDenied>当前账号没有查看网站分析的权限。</AccessDenied>;
  const error = !matches ? '服务返回的统计范围或排行与当前选择不一致，请刷新。'
    : resource.errorStatus === 404 ? '当前 API 尚未提供官网流量报表。' : resource.error;

  return <section className={styles.page} aria-labelledby="site-analytics-heading">
    <header className={styles.heading}>
      <h1 id="site-analytics-heading">网站分析</h1>
      <Button loading={loading} icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
    </header>
    <V2RangeControls preset={preset} custom={custom} onPreset={selectPreset} onCustom={setCustom} onApply={applyRange} />
    {loading && <Spin description="正在读取官网流量…" />}
    {!loading && error && <Alert type="error" showIcon title="官网流量读取失败" description={error} />}
    {view && !error && <>
      <div className={styles.period}>
        <Typography.Text>统计范围　{days.from} 至 {days.to}（北京时间）</Typography.Text>
        <Typography.Text type="secondary">统计截止　{reportTime(view.range.end)}</Typography.Text>
      </div>
      <TrafficView {...view} trendMetric={trendMetric} onTrendMetricChange={setTrendMetric} ranking={{ ...view.ranking,
        onMetricChange: metric => setRank({ metric, page: 1 }), onPageChange: page => setRank(current => ({ ...current, page })),
      }} />
    </>}
  </section>;
}
