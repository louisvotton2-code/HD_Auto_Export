import { useEffect, useRef } from 'react';
import { init, use, type ComposeOption, type EChartsType } from 'echarts/core';
import { BarChart, LineChart, PieChart, type BarSeriesOption, type LineSeriesOption, type PieSeriesOption } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, type GridComponentOption, type LegendComponentOption, type TooltipComponentOption } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import styles from './site-analytics.module.css';

use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

export type AnalyticsChartOption = ComposeOption<BarSeriesOption | LineSeriesOption | PieSeriesOption
  | GridComponentOption | LegendComponentOption | TooltipComponentOption>;

export function AnalyticsChart({ label, option, className }: { label: string; option: AnalyticsChartOption; className?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const instance = init(element, undefined, { renderer: 'svg' });
    chart.current = instance;
    const resize = () => instance.resize();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(element);
    else window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => { chart.current?.setOption(option, { notMerge: true }); }, [option]);

  return <div role="img" aria-label={label} className={className}>
    <div ref={container} className={styles.chartSurface} aria-hidden="true" />
  </div>;
}
