import { useEffect, useState } from 'react';
import { Alert, Button, Spin, Tabs, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { AnalyticsReportResponseSchema } from '@hd/contracts/analytics';
import { usePrivateResource } from '../../shared/api/use-private-resource';
import { AccessDenied } from '../auth';
import { matchesReportDates, presetDates, type AnalyticsPeriod, type DateRange, type RangePreset } from './analytics-range';
import { ConversionView } from './v2-conversion-view';
import { MarketView, type MarketDimension } from './v2-market-view';
import { AnalyticsCollectionQuality, OverviewView, type OverviewMetric } from './v2-overview-view';
import { V2RangeControls } from './v2-range-controls';
import { V2VehicleView, type V2VehicleMetric } from './v2-vehicle-view';
import { collectionQuality, conversionData, marketData, marketDimensions, overviewData, rankingMetric, reportTime, vehicleMetrics, vehicleRows } from './v2-report-model';
import styles from './site-analytics.module.css';

const tabs = [{ key: 'conversion', label: '从浏览到联系' }, { key: 'market', label: '市场来源' },
  { key: 'vehicles', label: '车型排行' }, { key: 'overview', label: '历史总览' }] as const;
type Tab = (typeof tabs)[number]['key'];
const coverageText = { not_collected: '所选区间的新维度尚未采集。旧版已记录的事件次数仍可显示。',
  gap: '所选区间有采集停顿。已记录的结果可能不完整。', partial: '所选区间采集不完整，合计和比例仅覆盖已记录的数据。', complete: null };

export function SiteAnalyticsV2({ period: { preset, days }, onPeriodChange, onUnavailable }: {
  period: AnalyticsPeriod; onPeriodChange: (period: AnalyticsPeriod) => void; onUnavailable: () => void;
}) {
  const [tab, setTab] = useState<Tab>('conversion');
  const [custom, setCustom] = useState(days);
  const [market, setMarket] = useState<MarketDimension>('country');
  const [metric, setMetric] = useState<OverviewMetric>('pageViews');
  const [ranking, setRanking] = useState<{ metric: V2VehicleMetric; page: number }>({ metric: 'detailViews', page: 1 });
  const granularity = days.from === days.to ? 'hour' : 'day';
  const sortMetric = rankingMetric(tab === 'vehicles' ? ranking.metric : 'detailViews');
  const page = tab === 'vehicles' ? ranking.page : 1;
  const query = new URLSearchParams({ startDate: days.from, endDate: days.to, granularity,
    metric: sortMetric, page: String(page), pageSize: '20' });
  const path = `/api/v1/admin/analytics/report?${query}`;
  const [request, setRequest] = useState({ path, revision: 0 });
  const resource = usePrivateResource(request.path, AnalyticsReportResponseSchema, request.revision, 12_000);
  const waiting = path !== request.path;
  const expired = resource.errorStatus === 401;
  const denied = resource.errorStatus === 403;
  const unavailable = resource.errorStatus === 404;
  const loading = !expired && (waiting || resource.loading);
  const report = !loading ? resource.data?.data : undefined;

  useEffect(() => {
    if (unavailable) { onUnavailable(); return; }
    if (!waiting || resource.loading || expired || denied) return;
    // The analytics API allows one active report read. Only issue the latest selection.
    setRequest(current => ({ path, revision: current.revision + 1 }));
  }, [path, waiting, resource.loading, expired, denied, unavailable, onUnavailable]);

  useEffect(() => {
    if (tab !== 'vehicles' || !report) return;
    const lastPage = Math.max(1, Math.ceil(report.ranking.total / (report.ranking.pageSize || 20)));
    if (ranking.page > lastPage) setRanking(current => ({ ...current, page: lastPage }));
  }, [tab, report, ranking.page]);

  useEffect(() => {
    if (preset === 'custom') return;
    const currentPreset = preset;
    function followBeijingDate() {
      const next = presetDates(currentPreset);
      if (next.from !== days.from || next.to !== days.to) setRange(next);
    }
    const timer = window.setInterval(followBeijingDate, 30_000);
    window.addEventListener('focus', followBeijingDate);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', followBeijingDate); };
  }, [preset, days, onPeriodChange]);

  function setRange(range: DateRange, nextPreset: RangePreset = preset) {
    onPeriodChange({ preset: nextPreset, days: range });
    setRanking(current => ({ ...current, page: 1 }));
  }

  function selectPreset(value: RangePreset) {
    if (value === 'custom') { setCustom(days); onPeriodChange({ preset: value, days }); return; }
    setRange(presetDates(value), value);
  }

  function reload() {
    resource.resume();
    if (preset !== 'custom') {
      const next = presetDates(preset);
      if (next.from !== days.from || next.to !== days.to) { setRange(next); return; }
    }
    setRequest(current => ({ path, revision: current.revision + 1 }));
  }

  if (denied) return <AccessDenied>当前账号没有查看网站分析的权限。</AccessDenied>;
  const matches = !report || (
    matchesReportDates(report.range, days) && report.granularity === granularity
    && report.ranking.metric === sortMetric && report.ranking.page === page
  );
  const error = resource.error ?? (matches ? undefined : '服务返回的统计区间或排行与当前选择不一致，请重新读取。');
  const content = <div className={styles.page}>
    {loading && <Spin description="正在读取网站分析…" />}
    {!loading && error && !unavailable && <Alert type="error" showIcon title="网站分析读取失败" description={error} />}
    {report && !error && <>
      <div className={styles.period}>
        <Typography.Text>统计范围　{days.from} 至 {days.to}（北京时间）</Typography.Text>
        <Typography.Text type="secondary">统计截止　{reportTime(report.range.end)}</Typography.Text>
      </div>
      {coverageText[report.coverage] && <Alert type="info" showIcon title={coverageText[report.coverage]} />}
      {tab === 'overview' && <OverviewView data={overviewData(report, preset === 'today')} metric={metric} onMetricChange={setMetric} />}
      {tab === 'market' && <MarketView dimension={market} dimensions={marketDimensions} onDimensionChange={setMarket} data={marketData(report, market)} />}
      {tab === 'vehicles' && <V2VehicleView metric={ranking.metric} availableMetrics={vehicleMetrics} rows={vehicleRows(report)}
        onMetricChange={next => setRanking({ metric: next, page: 1 })} page={report.ranking.page} pageSize={report.ranking.pageSize}
        emptyText={report.coverage === 'complete' ? '所选期间暂无车辆行为记录' : '所选期间暂无可用于排行的车辆记录，统计覆盖可能不完整'}
        total={report.coverage === 'not_collected' && report.ranking.total === 0 ? null : report.ranking.total}
        onPageChange={page => setRanking(current => ({ ...current, page }))} />}
      {tab === 'conversion' && <ConversionView data={conversionData(report)} />}
      {tab === 'overview' && <AnalyticsCollectionQuality quality={collectionQuality(report)} />}
    </>}
  </div>;

  return <section className={styles.page} aria-labelledby="site-analytics-heading">
    <header className={styles.heading}>
      <h1 id="site-analytics-heading">网站分析</h1>
      <Button loading={loading} icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
    </header>
    <V2RangeControls preset={preset} custom={custom} onPreset={selectPreset} onCustom={setCustom} onApply={setRange} />
    <Typography.Text type="secondary">当前采集需访客同意网站分析，报表也可能显示已有的历史记录。全站访问量和匿名联系点击请查看「官网流量」。</Typography.Text>
    <Tabs activeKey={tab} onChange={key => setTab(key as Tab)} style={{ minWidth: 0 }}
      items={tabs.map(item => ({ ...item, children: item.key === tab ? content : null }))} />
  </section>;
}
