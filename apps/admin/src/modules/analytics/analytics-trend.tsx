import styles from './site-analytics.module.css';

type TrendPoint = { day: string; value: number | null };

const countFormat = new Intl.NumberFormat('zh-CN');

export function AnalyticsTrend({ points, metric }: { points: readonly TrendPoint[]; metric: string }) {
  const limit = Math.max(1, ...points.map(point => point.value ?? 0));
  const labels = points.filter((_, index) => index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2));

  return <>
    <figure className={styles.trend} aria-label={`${metric}每日趋势`}>
      <div className={styles.axis} aria-hidden="true"><span>{countFormat.format(limit)}</span><span>0</span></div>
      <ol className={styles.bars} aria-hidden="true">
        {points.map(({ day, value }) => (
          <li key={day} title={`${day} · ${value === null ? '未采集' : countFormat.format(value)}`}
            className={value === null ? styles.uncollected : undefined}>
            {value !== null && <span style={{ height: `${value / limit * 100}%` }} />}
          </li>
        ))}
      </ol>
      <div className={styles.dates} aria-hidden="true">{labels.map(point => <time key={point.day} dateTime={point.day}>{point.day.slice(5)}</time>)}</div>
    </figure>
    <details className={styles.daily}>
      <summary>查看每日数据</summary>
      <dl>{points.map(({ day, value }) => <div key={day}>
        <dt><time dateTime={day}>{day}</time></dt>
        <dd>{value === null ? '未采集' : countFormat.format(value)}</dd>
      </div>)}</dl>
    </details>
  </>;
}
