import {
  GenerateTranslationPlanRequestSchema, SaveVehicleTranslationBundleSchema, TranslationPlanResultSchema, TranslationPlanSchema,
  type AdminVehicle, type DisplayField, type SaveVehicleTranslationBundle, type TranslationPlan, type TranslationPlanResult,
  type VehicleTranslationBundle,
} from '@hd/contracts/admin';
import { translationSourceHash } from './machine-translation-model';

export type TranslationWorkspaceData = Pick<SaveVehicleTranslationBundle, 'content' | 'localization' | 'sourceLanguageConfirmations'>;
const locales = ['zh', 'en', 'ru'] as const;
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class TranslationWorkspaceChanged extends Error {
  constructor(message = '车辆或译文已变化，旧翻译结果没有覆盖当前输入。请比较最新资料。') { super(message); }
}

export function workspaceData(bundle: VehicleTranslationBundle): TranslationWorkspaceData {
  return structuredClone({ content: bundle.vehicle.draft.content, localization: bundle.localization.data, sourceLanguageConfirmations: [] });
}

export function workspaceDirty(base: VehicleTranslationBundle | null, data: TranslationWorkspaceData | null): boolean {
  return !!base && !!data && !equal(workspaceData(base), data);
}

/** The server, after an explicit PUT, derives authoritative Chinese without inventing human review. */
export function workspaceNeedsChineseNormalization(bundle: VehicleTranslationBundle): boolean {
  return [...Object.values(bundle.vehicle.draft.content), ...bundle.localization.data.fields].some(field => {
    if (field.sourceLanguage.split('-')[0].toLowerCase() !== 'zh') return false;
    const chinese = field.translations.zh;
    if (!field.sourceText?.trim()) return chinese !== null;
    return !chinese || chinese.text !== field.sourceText || chinese.kind !== 'original' || chinese.engineVersion !== null ||
      chinese.sourceVersion !== field.sourceVersion || chinese.reviewStatus === 'stale';
  });
}

export function workspaceSaveRequest(base: VehicleTranslationBundle, data: TranslationWorkspaceData): SaveVehicleTranslationBundle {
  // Chinese declarations are explicit refs; never relabel an old source in an input handler.
  for (const name of ['title', 'description'] as const) {
    const original = base.vehicle.draft.content[name], current = data.content[name];
    if (original.sourceText !== current.sourceText || original.sourceLanguage !== current.sourceLanguage || original.sourceVersion !== current.sourceVersion)
      throw new TranslationWorkspaceChanged('正文原文需在车辆资料中保存，不能从多语工作区覆盖。');
  }
  const required = new Set(base.sourceLanguageConfirmationRequired);
  if (data.sourceLanguageConfirmations.some(ref => !required.has(ref)) ||
      data.sourceLanguageConfirmations.length && data.sourceLanguageConfirmations.length !== required.size)
    throw new TranslationWorkspaceChanged('中文来源确认范围已变化，请重新读取当前资料。');
  return SaveVehicleTranslationBundleSchema.parse({ version: base.vehicle.version, localizationRevision: base.localization.revision, ...data });
}

export function assertWorkspaceFresh(current: AdminVehicle, fresh: VehicleTranslationBundle, known?: VehicleTranslationBundle | null) {
  if (current.id !== fresh.vehicle.id || current.deletedAt || fresh.vehicle.deletedAt || fresh.vehicle.version < current.version ||
      fresh.localization.vehicleId !== fresh.vehicle.id || fresh.localization.vehicleVersion !== fresh.vehicle.version ||
      known && (known.vehicle.id !== fresh.vehicle.id || fresh.vehicle.version < known.vehicle.version || fresh.localization.revision < known.localization.revision))
    throw new TranslationWorkspaceChanged('已忽略过期、错配或已删除车辆的多语资料，当前输入仍保留。');
}

export function assertWorkspaceSnapshot(base: VehicleTranslationBundle, fresh: VehicleTranslationBundle) {
  if (!equal(base, fresh)) throw new TranslationWorkspaceChanged();
}

function fieldFor(bundle: VehicleTranslationBundle, ref: string) {
  if (ref === 'content.title') return bundle.vehicle.draft.content.title;
  if (ref === 'content.description') return bundle.vehicle.draft.content.description;
  return bundle.localization.data.fields.find(field => field.ref === ref);
}

export async function assertTranslationPlan(planInput: TranslationPlan, base: VehicleTranslationBundle) {
  const plan = TranslationPlanSchema.parse(planInput);
  if (plan.vehicleId !== base.vehicle.id || plan.vehicleVersion !== base.vehicle.version || plan.localizationRevision !== base.localization.revision ||
      base.vehicle.deletedAt || base.sourceLanguageConfirmationRequired.length) throw new TranslationWorkspaceChanged();
  for (const planned of plan.fields) {
    const source = fieldFor(base, planned.ref);
    if (!source || source.sourceLanguage.split('-')[0].toLowerCase() !== 'zh' || source.sourceText !== planned.sourceText || source.sourceVersion !== planned.sourceVersion)
      throw new TranslationWorkspaceChanged();
    const hash = 'sourceHash' in source ? source.sourceHash : await translationSourceHash(source.sourceLanguage, source.sourceText);
    if (hash !== planned.sourceHash) throw new TranslationWorkspaceChanged();
  }
}

export function translationPlanConfirmation(plan: TranslationPlan, now = Date.now()) {
  if (Date.parse(plan.expiresAt) <= now) throw new TranslationWorkspaceChanged('翻译计划已过期，请重新查看范围和费用后确认。');
  if (plan.provider === 'disabled') throw new Error('翻译服务尚未启用，不能开始生成。');
  return GenerateTranslationPlanRequestSchema.parse({ confirmed: true, sourceFingerprint: plan.sourceFingerprint,
    maximumCharacters: plan.estimate.maximumCharacters, acceptUnknownCost: true });
}

export async function applyTranslationPlanResult(
  plan: TranslationPlan, base: VehicleTranslationBundle, current: TranslationWorkspaceData,
  fresh: VehicleTranslationBundle, resultInput: TranslationPlanResult,
): Promise<{ data: TranslationWorkspaceData; applied: number; protected: number; missing: number }> {
  assertWorkspaceSnapshot(base, fresh);
  if (workspaceDirty(base, current)) throw new TranslationWorkspaceChanged();
  await assertTranslationPlan(plan, fresh);
  const result = TranslationPlanResultSchema.parse(resultInput);
  if (result.planId !== plan.id || result.vehicleId !== plan.vehicleId || result.vehicleVersion !== plan.vehicleVersion ||
      result.localizationRevision !== plan.localizationRevision || result.sourceFingerprint !== plan.sourceFingerprint || result.fields.length !== plan.fields.length)
    throw new TranslationWorkspaceChanged();
  const data = workspaceData(fresh);
  let applied = 0, protectedCount = 0, missing = 0;
  for (const next of result.fields) {
    const planned = plan.fields.find(field => field.ref === next.ref);
    const saved = fieldFor(fresh, next.ref);
    if (!planned || !saved || next.sourceText !== planned.sourceText || next.sourceHash !== planned.sourceHash ||
        next.sourceVersion !== planned.sourceVersion || next.mode !== planned.mode || next.sourceCharacters !== planned.sourceCharacters)
      throw new TranslationWorkspaceChanged();
    const target = next.ref === 'content.title' ? data.content.title : next.ref === 'content.description' ? data.content.description
      : data.localization.fields.find(field => field.ref === next.ref)!;
    for (const locale of locales) {
      const prior = saved.translations[locale], translated = next.translations[locale];
      if (next.targetHumanEditVersions[locale] !== (prior?.humanEditVersion ?? null)) throw new TranslationWorkspaceChanged();
      if (translated && locale !== 'zh' && translated.engineVersion !== plan.engineVersion) throw new TranslationWorkspaceChanged();
      if (!translated) { if (locale !== 'zh') missing++; continue; }
      if (prior?.kind === 'human' || prior?.reviewStatus === 'approved') { protectedCount++; continue; }
      // Result schema requires original Chinese and machine/pending targets with exact revisions.
      target.translations[locale] = structuredClone(translated);
      if (locale !== 'zh') applied++;
    }
  }
  return { data, applied, protected: protectedCount, missing };
}

export function workspaceComparison(local: TranslationWorkspaceData, remote: VehicleTranslationBundle, label: (field: DisplayField) => string) {
  const rows: Array<{ key: string; label: string; local: string; remote: string }> = [];
  const summarize = (field: VehicleTranslationBundle['vehicle']['draft']['content']['title'] | DisplayField | undefined) => field
    ? [`原文：${field.sourceText ?? '未填写'}`, ...locales.map(locale => `${({ zh: '中文', en: '英文', ru: '俄文' })[locale]}：${field.translations[locale]?.text ?? '未填写'}`)].join('\n') : '当前无此项';
  for (const name of ['title', 'description'] as const) if (!equal(local.content[name], remote.vehicle.draft.content[name]))
    rows.push({ key: name, label: name === 'title' ? '标题' : '车况描述', local: summarize(local.content[name]), remote: summarize(remote.vehicle.draft.content[name]) });
  const theirs = remote.localization.data;
  for (const ref of new Set([...local.localization.fields.map(field => field.ref), ...theirs.fields.map(field => field.ref)])) {
    const ours = local.localization.fields.find(field => field.ref === ref), other = theirs.fields.find(field => field.ref === ref);
    if (!equal(ours, other)) rows.push({ key: ref, label: label(ours ?? other!), local: summarize(ours), remote: summarize(other) });
  }
  if (!equal(local.localization.facts, theirs.facts)) rows.push({ key: 'facts', label: '代系与驱动形式',
    local: `${local.localization.facts.generation?.name ?? '未填写'} / ${local.localization.facts.drivetrain ?? '未知'}`,
    remote: `${theirs.facts.generation?.name ?? '未填写'} / ${theirs.facts.drivetrain ?? '未知'}` });
  return rows;
}
