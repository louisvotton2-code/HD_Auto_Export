export type PublicAnalyticsAction = 'filter_submit' | 'search_zero_results' | 'calculator_complete';
export const publicAnalyticsActionEvent = 'hd-auto:public-analytics-action';

export function recordPublicAnalyticsAction(type: PublicAnalyticsAction) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent<PublicAnalyticsAction>(publicAnalyticsActionEvent, { detail: type }));
}
