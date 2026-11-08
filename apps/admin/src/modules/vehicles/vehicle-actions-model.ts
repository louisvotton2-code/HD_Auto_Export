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
  if (normalized.startsWith('localization.')) {
    const language = normalized.split('.').at(-1);const name = language && language in locale ? locale[language as keyof typeof locale] : '对应语言';
    return `公开字段多语：请填写并审核${name}的当前来源版本`;
  }
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


/** A frozen publish receipt describes an old operation, not necessarily the current visibility. */
export function publicationFeedback(
  receipt: Pick<AdminVehicle, 'publishedRevisionId'>,
  current: Pick<AdminVehicle, 'publicationState' | 'publishedRevisionId' | 'deletedAt'>,
): { tone: 'success' | 'info'; text: string } {
  if (current.deletedAt) return { tone: 'info', text: '已核对：车辆当前在回收站，未恢复公开。' };
  if (current.publicationState === 'archived') return { tone: 'info', text: '已核对：车辆当前已下架，未重新发布。' };
  if (current.publicationState !== 'published') return { tone: 'info', text: '已核对：车辆当前为未发布草稿，未自动发布。' };
  if (current.publishedRevisionId !== receipt.publishedRevisionId) return { tone: 'info', text: '已核对：车辆当前已有其他发布版本，请以最新公开内容为准。' };
  return { tone: 'success', text: '已确认当前公开版本，请核对公开内容。' };
}

type PublicationControlInput = Pick<AdminVehicle, 'publicationState' | 'publishedRevisionId' | 'deletedAt' | 'hasUnpublishedChanges'>;

/** Only the server can compare the saved publishable draft with its immutable snapshot. */
export function publicationControlState(vehicle: PublicationControlInput): {
  blocked: boolean;
  needsRefresh: boolean;
  actionLabel: string;
  title: string;
  description: string;
  tone: 'success' | 'info' | 'warning';
} {
  if (vehicle.deletedAt) return {
    blocked: true, needsRefresh: false, actionLabel: '已删除，需先恢复', title: '车辆位于回收站',
    description: '恢复后只回到未发布草稿，仍需核对资料后明确发布。', tone: 'info',
  };
  if (vehicle.publicationState !== 'published') return {
    blocked: false, needsRefresh: false, actionLabel: '发布车辆',
    title: vehicle.publicationState === 'archived' ? '车辆已下架，尚未重新公开' : '草稿尚未发布',
    description: '保存只更新后台草稿，确认发布后才会进入公开内容。', tone: 'info',
  };
  if (vehicle.hasUnpublishedChanges === null || !vehicle.publishedRevisionId) return {
    blocked: true, needsRefresh: true, actionLabel: '先核对发布状态', title: '发布差异待核对',
    description: '当前记录尚不能确认是否有待发布修改。请读取最新状态后再决定，未将其视为没有修改。', tone: 'warning',
  };
  if (vehicle.hasUnpublishedChanges === false) return {
    blocked: true, needsRefresh: false, actionLabel: '已发布，暂无待发布修改', title: '已发布，暂无待发布修改',
    description: '已保存的对外内容与当前公开版本一致。内部信息和库存核验独立保存，无需再次发布。', tone: 'success',
  };
  return {
    blocked: false, needsRefresh: false, actionLabel: '发布已保存的修改', title: '有已保存的修改待发布',
    description: '公开页面仍显示上一个发布版本。请检查当前草稿，再确认更新公开内容。', tone: 'warning',
  };
}
