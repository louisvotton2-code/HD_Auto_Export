import { Card, Empty, Statistic, Typography } from 'antd';
import { AnalyticsChart, type AnalyticsChartOption } from './analytics-chart';
import sectionStyles from './site-analytics.module.css';
import styles from './v2-conversion-view.module.css';

type CatalogFunnel = {
  catalogSessions: number | null;
  vehicleClickSessions: number | null;
  detailSessions: number | null;
  contactSessions: number | null;
};

export type ConversionBreakdown = {
  catalogFunnel: CatalogFunnel;
  directDetail: { detailSessions: number | null; contactSessions: number | null };
  search: {
    filterSubmissions: number | null;
    zeroResults: number | null;
    calculatorCompletions: number | null;
  };
};

const funnelStages = [
  { key: 'catalogSessions', label: '浏览车辆目录' },
  { key: 'vehicleClickSessions', label: '点击车辆卡片' },
  { key: 'detailSessions', label: '浏览同一车辆详情' },
  { key: 'contactSessions', label: '主动联系同一车辆' },
] as const;

const countFormat = new Intl.NumberFormat('zh-CN');
const chartColors = ['#94671d', '#a5782c', '#b1843b', '#6b5327'];

function funnelOption(data: CatalogFunnel): AnalyticsChartOption {
  return {
    animation: false,
    grid: { left: 116, right: 54, top: 12, bottom: 24 },
    tooltip: { trigger: 'item', renderMode: 'richText', confine: true, valueFormatter: value => typeof value === 'number' ? `${countFormat.format(value)} 次` : '未采集' },
    xAxis: { type: 'value', minInterval: 1, splitNumber: 4, splitLine: { lineStyle: { color: '#eee6d9' } } },
    yAxis: { type: 'category', inverse: true, data: funnelStages.map(stage => stage.label),
      axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: '#473e2d', fontSize: 12 } },
    series: [{
      name: '浏览过程', type: 'bar', barMaxWidth: 24,
      data: funnelStages.map(({ key }, index) => ({ value: data[key], itemStyle: { color: chartColors[index] } })),
      label: { show: true, position: 'right', color: '#473e2d', formatter: ({ value }) => typeof value === 'number' ? countFormat.format(value) : '' },
    }],
  };
}

function Funnel({ data }: { data: CatalogFunnel }) {
  const hasData = funnelStages.some(({ key }) => data[key] !== null);
  return <>
    {hasData ? <AnalyticsChart label="目录到联系的访客路径" option={funnelOption(data)} />
      : <Typography.Paragraph className={sectionStyles.hint}>所选期间未采集可用的浏览路径。</Typography.Paragraph>}
    <details className={styles.details}>
      <summary>查看各步骤次数</summary>
      <ol className={styles.stages} role="list">
        {funnelStages.map(({ key, label }) => {
          const count = data[key];
          return <li key={key}>
            <span>{label}</span>
            <span className={styles.stageCount}>{count === null ? '未采集' : <><strong>{countFormat.format(count)}</strong> 次</>}</span>
          </li>;
        })}
      </ol>
    </details>
    <Typography.Paragraph className={styles.chartHint}>
      点击车辆卡片后，按顺序统计同一辆车的详情浏览和联系点击。日期以这次浏览开始的北京时间为准。
    </Typography.Paragraph>
  </>;
}

export function ConversionView({ data }: { data: ConversionBreakdown | null }) {
  return <section aria-label="从浏览到联系" className={styles.view}>
    {!data ? <Card className={sectionStyles.section}>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="所选期间未采集浏览路径、站外直达详情或筛选与费用计算数据" />
    </Card> : <>
      <div className={styles.cards}>
        <Card className={sectionStyles.section} title="从车辆目录到点联系">
          <Funnel data={data.catalogFunnel} />
        </Card>
        <div className={styles.related}>
          <Card className={sectionStyles.section} title="从站外打开车辆详情">
            <div className={styles.metrics}>
              <Statistic title="从站外直达详情" value={data.directDetail.detailSessions ?? '未采集'} />
              <Statistic title="随后点联系同一辆车" value={data.directDetail.contactSessions ?? '未采集'} />
            </div>
          </Card>
          <Card className={sectionStyles.section} title="筛选与费用计算">
            <div className={styles.metrics}>
              <Statistic title="筛选提交次数" value={data.search.filterSubmissions ?? '未采集'} />
              <Statistic title="零结果次数" value={data.search.zeroResults ?? '未采集'} />
              <Statistic title="费用计算完成次数" value={data.search.calculatorCompletions ?? '未采集'} />
            </div>
            <Typography.Paragraph className={styles.chartHint}>零结果只统计成功返回且确实没有车辆的查询。</Typography.Paragraph>
          </Card>
        </div>
      </div>
      <Typography.Text type="secondary">联系点击表示联系意向。实际收到的询盘以客服记录为准。</Typography.Text>
    </>}
  </section>;
}
