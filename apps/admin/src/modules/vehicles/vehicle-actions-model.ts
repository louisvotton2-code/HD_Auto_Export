import type { AdminVehicle } from '@hd/contracts/admin';

export type PublishIntent = {
  key: string;
  body: string;
  startedAt: number;
  version: number;
};

/** Keep one immutable publication request until its outcome is established. */
export function makePublishIntent(vehicle: Pick<AdminVehicle, 'version'>, key: string, now: number): PublishIntent {
  return { key, body: JSON.stringify({ version: vehicle.version }), startedAt: now, version: vehicle.version };
}

export function publicationIssueLabel(path: string): string {
  const normalized = path.replace(/^draft\./, '');
  const locale = { zh: '中文', en: '英文', ru: '俄文' };
  const match = /^content\.(title|description)\.translations\.(zh|en|ru)(?:\.|$)/.exec(normalized);
  if (match) return `${locale[match[2] as keyof typeof locale]}${match[1] === 'title' ? '标题' : '描述'}：请填写并审核当前原文版本`;
  if (normalized === 'facts.make' || normalized.startsWith('facts.make.')) return '品牌：请选择或新增品牌';
  if (normalized === 'facts.model' || normalized.startsWith('facts.model.')) return '车型：请选择或新增车型';
  if (normalized === 'facts.location' || normalized.startsWith('facts.location.')) return '所在地：请填写国家代码';
  if (normalized === 'content.title.sourceText') return '标题原文：请填写原文标题';
  if (normalized === 'availability') return '库存：请实际核验库存状态并记录核验时间';
  if (normalized === 'media' || normalized.startsWith('media.')) return '图片：请确认全部图片处理完成，选择一张封面并保存草稿';
  if (normalized === 'price' || normalized.startsWith('price.')) return '公开价格：请检查价格口径、金额和币种';
  return '车辆资料：请检查未满足的发布条件';
}

/** A later rejection cannot prove that an earlier response-lost publish never committed. */
export function keepPublishIntent(status: number, wasUncertain: boolean): boolean {
  return wasUncertain || ![400, 401, 403, 404, 409, 413, 422].includes(status);
}

export const publicationAttemptExpired = (intent: PublishIntent, now: number) => now - intent.startedAt >= 24 * 60 * 60 * 1000;
