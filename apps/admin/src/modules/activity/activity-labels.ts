import type { ActivityEvent } from '@hd/contracts/admin';

const actions: Record<string, string> = {
  'vehicle.create': '创建车辆', 'vehicle.save': '保存草稿', 'vehicle.publish': '发布车辆',
  'vehicle.archive': '下架车辆', 'vehicle.availability': '更新库存状态', 'vehicle.delete': '删除车辆',
  'vehicle.restore': '恢复车辆', 'vehicle.translationBundle.save': '保存公开多语',
  'vehicle.localization.save': '保存展示译文', 'vehicle.preview.confirm': '确认发布预览',
  'media.create': '申请图片上传', 'media.upload': '图片文件上传完成',
  'media.complete': '图片处理完成', 'media.delete': '删除图片',
  'vehicle.media.add': '添加图片', 'vehicle.media.remove': '移除图片', 'vehicle.media.reorder': '调整图片顺序',
  'vehicle.media.cover': '设置封面', 'external.override': '人工修订', 'external.override.save': '保存人工修订',
};
export const activityAction = (action: string) => Object.hasOwn(actions, action) ? actions[action] : `其他操作（${action}）`;

const fields: Record<string, string> = {
  'facts.make': '品牌', 'facts.model': '车型', 'facts.trim': '配置版本', 'facts.modelYear': '年款',
  'facts.registrationStatus': '登记状态', 'facts.firstRegistration': '首次登记日期',
  'facts.manufacturedAt': '生产日期', 'facts.mileageKm': '里程', 'facts.powertrain': '动力类型',
  'facts.engineCc': '排量', 'facts.powerKw': '功率', 'facts.body': '车身', 'facts.transmission': '变速箱',
  'facts.location': '所在地', 'price': '公开价格', 'price.money.amount': '公开价格金额',
  'price.money.currency': '公开价格币种', 'content.title': '车辆标题', 'content.description': '车况描述',
  'configuration': '车辆配置', 'media': '车辆图片', 'internal': '内部资料', 'internal.notes': '内部备注',
  'internal.purchaseCost': '采购成本', 'availability': '库存状态', 'publicationState': '发布状态',
  'deletedAt': '删除时间', 'hidden': '人工隐藏', 'overrides': '人工修订',
};
export function activityField(path: string): string {
  const normalized = path.replace(/^draft\./, '');
  const match = Object.keys(fields).filter(key => normalized === key || normalized.startsWith(`${key}.`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? `${fields[match]} · ${path}` : path;
}

export function activityActor(actor: ActivityEvent['actor']): string {
  if (actor.kind === 'system') return '系统';
  if (actor.kind === 'unknown') return '操作人未知';
  return `${actor.name?.trim() || '员工姓名未记录'}${actor.staffId ? ` · 员工 ID ${actor.staffId}` : ' · 员工 ID 未记录'}`;
}

/** Use one explicit timezone on every machine, while retaining the DB UTC value in the UI. */
export function activityTime(value: string): string {
  return `${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value))}（北京时间）`;
}
