import { useMemo } from 'react';
import { AnalyticsChart, type AnalyticsChartOption } from './analytics-chart';
import styles from './site-analytics.module.css';

type TrendPoint = { day: string; value: number | null; label?: string; missingLabel?: string; coverageLabel?: string };

const countFormat = new Intl.NumberFormat('zh-CN');

function pointValue({ value, missingLabel, coverageLabel }: TrendPoint) {
  if (value === null) return coverageLabel ?? missingLabel ?? '未采集';
  const count = countFormat.format(value);
  return coverageLabel ? `${count}（${coverageLabel}）` : count;
}

export function AnalyticsTrend({ points, metric, interval = 'day' }: { points: readonly TrendPoint[]; metric: string; interval?: 'day' | 'hour' }) {
  const grouping = interval === 'hour' ? '逐小时' : '每日';
  const title = `${metric}${grouping}趋势`;
  const hasData = points.some(point => point.value !== null);
  const hasGaps = points.some(point => point.value === null);
  const option = useMemo<AnalyticsChartOption>(() => ({
    animation: false,
    grid: { top: 14, right: 12, bottom: 28, left: 8, outerBoundsMode: 'same' },
    textStyle: { color: '#716b5f' },
    xAxis: {
      type: 'category', boundaryGap: false, data: points.map(point => point.label ?? point.day.slice(5)),
      axisLabel: { hideOverlap: true, showMinLabel: true, showMaxLabel: true },
      axisTick: { show: false }, axisLine: { lineStyle: { color: '#dcd7ca' } },
    },
    yAxis: { type: 'value', min: 0, minInterval: 1, splitNumber: 4, splitLine: { lineStyle: { color: '#ede8dd' } } },
    tooltip: {
      trigger: 'axis', renderMode: 'richText', confine: true,
      formatter: params => {
        const vertex = Array.isArray(params) ? params[0] : params;
        const point = typeof vertex?.dataIndex === 'number' ? points[vertex.dataIndex] : undefined;
        return point ? `${point.label ?? point.day}\n${metric}　${pointValue(point)}` : '';
      },
    },
    series: [{
      type: 'line', name: metric, data: points.map(point => point.value), connectNulls: false,
      symbol: 'circle', symbolSize: points.length > 31 ? 4 : 6, showAllSymbol: true,
      lineStyle: { color: '#9a7524', width: 2.5 }, itemStyle: { color: '#9a7524' }, areaStyle: { color: '#c6a660', opacity: 0.22 },
    }],
  }), [metric, points]);

  return <figure className={styles.trend} aria-label={title}>
    {hasData
      ? <AnalyticsChart label={title} option={option} />
      : <p className={styles.trendEmpty}>所选期间未采集此项数据</p>}
    {hasData && hasGaps && <p className={styles.trendNote}>图上空白时段未采集。</p>}
    <details className={styles.daily}>
      <summary>查看{grouping}数据</summary>
      <dl>{points.map(point => <div key={point.day} title={`${point.label ?? point.day} · ${pointValue(point)}`}>
        <dt><time dateTime={point.day}>{point.label ?? point.day}</time></dt>
        <dd>{pointValue(point)}</dd>
      </div>)}</dl>
    </details>
  </figure>;
}
