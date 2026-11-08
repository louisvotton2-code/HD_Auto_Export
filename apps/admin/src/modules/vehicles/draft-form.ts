import { VehicleDraftInputSchema, type PartialDate, type VehicleDraftInput } from '@hd/contracts/admin';
import { sourceForKind } from './vehicle-editor-helpers';

export const publicationLabels = { draft: '草稿', published: '已发布', archived: '已下架' };
export const availabilityLabels = { available: '可售', reserved: '已预订', sold: '已售', unknown: '待核验' };
export const powertrainLabels = { petrol: '汽油', diesel: '柴油', hev: '油电混动', phev: '插电混动', erev: '增程', bev: '纯电', lpg: '液化石油气', other: '其他', unknown: '未知' };

export function emptyDraft(): VehicleDraftInput {
  const text = () => ({ sourceLanguage: 'zh', sourceText: null, sourceVersion: 1, translations: { zh: null, en: null, ru: null } });
  return {
    source: { kind: 'manual' },
    facts: { make: null, model: null, trim: null, modelYear: null, manufacturedAt: null, firstRegistration: null, registrationStatus: 'unknown', mileageKm: null, powertrain: 'unknown', engineCc: null, powerKw: null, body: null, transmission: null, location: null },
    price: { kind: 'on_request', money: null, includes: [] },
    content: { title: text(), description: text() }, media: [],
    internal: { purchaseCost: null, notes: null, supplierContact: null, vin: null },
  };
}

export function draftToForm(draft: VehicleDraftInput) {
  const { facts, price, content, internal, source } = draft;
  return {
    sourcePlatformId: source.kind === 'external' ? source.platform.id : '',
    sourcePlatformName: source.kind === 'external' ? source.platform.name : '',
    sourceListingUrl: source.kind === 'external' ? source.listingUrl : '',
    sourceExternalId: source.kind === 'external' ? source.externalId : '',
    sourceCollectedAt: source.kind === 'external' ? source.collectedAt : '',
    sourceUpdatedAt: source.kind === 'external' ? source.sourceUpdatedAt ?? '' : '',
    makeId: facts.make?.id ?? '', makeName: facts.make?.name ?? '',
    modelId: facts.model?.id ?? '', modelName: facts.model?.name ?? '',
    trimId: facts.trim?.id ?? '', trimName: facts.trim?.name ?? '',
    modelYear: facts.modelYear?.toString() ?? '', mileageKm: facts.mileageKm?.toString() ?? '',
    engineCc: facts.engineCc?.toString() ?? '', powerKw: facts.powerKw?.toString() ?? '',
    manufacturedAt: facts.manufacturedAt?.value ?? '', manufacturedPrecision: facts.manufacturedAt?.precision ?? 'month',
    firstRegistration: facts.firstRegistration?.value ?? '', registrationPrecision: facts.firstRegistration?.precision ?? 'month',
    registrationStatus: facts.registrationStatus, powertrain: facts.powertrain,
    body: facts.body ?? ('' as const), transmission: facts.transmission ?? ('' as const),
    country: facts.location?.country ?? '', city: facts.location?.city ?? '', locationName: facts.location?.displayName ?? '',
    priceKind: price.kind, amount: price.money?.amount ?? '', currency: price.money?.currency ?? 'USD', includes: price.includes.join('\n'),
    titleLanguage: content.title.sourceLanguage, title: content.title.sourceText ?? '',
    descriptionLanguage: content.description.sourceLanguage, description: content.description.sourceText ?? '',
    purchaseAmount: internal.purchaseCost?.amount ?? '', purchaseCurrency: internal.purchaseCost?.currency ?? 'USD',
    notes: internal.notes ?? '', supplierContact: internal.supplierContact ?? '', vin: internal.vin ?? '',
  };
}
export type DraftForm = ReturnType<typeof draftToForm>;
const nullable = (value: string) => value.trim() || null;
const numeric = (value: string) => value.trim() === '' ? null : /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : Number.NaN;
const named = (id: string, name: string) => !id.trim() && !name.trim() ? null : { id: id.trim(), name: name.trim() };
const partialDate = (value: string, precision: PartialDate['precision']) => !value.trim() ? null : { value: value.trim(), precision };

/** Start from the fetched draft: untouched media and translation revisions must survive a full replacement. */
export function formToDraft(base: VehicleDraftInput, form: DraftForm): VehicleDraftInput {
  const result = structuredClone(base);
  const previous = draftToForm(base);
  const unchanged = (...keys: (keyof DraftForm)[]) => keys.every((key) => form[key] === previous[key]);
  result.facts = {
    ...result.facts,
    make: named(form.makeId, form.makeName), model: named(form.modelId, form.modelName), trim: named(form.trimId, form.trimName),
    modelYear: numeric(form.modelYear), mileageKm: numeric(form.mileageKm), engineCc: numeric(form.engineCc), powerKw: numeric(form.powerKw),
    manufacturedAt: partialDate(form.manufacturedAt, form.manufacturedPrecision) as PartialDate | null,
    firstRegistration: partialDate(form.firstRegistration, form.registrationPrecision) as PartialDate | null,
    registrationStatus: form.registrationStatus, powertrain: form.powertrain,
    body: form.body || null, transmission: form.transmission || null,
    location: !form.country.trim() && !form.city.trim() && !form.locationName.trim() ? null : { country: form.country.trim().toUpperCase(), city: nullable(form.city), displayName: nullable(form.locationName) },
  };
  const factFields: Record<keyof VehicleDraftInput['facts'], (keyof DraftForm)[]> = {
    make: ['makeId', 'makeName'], model: ['modelId', 'modelName'], trim: ['trimId', 'trimName'],
    modelYear: ['modelYear'], mileageKm: ['mileageKm'], engineCc: ['engineCc'], powerKw: ['powerKw'],
    manufacturedAt: ['manufacturedAt', 'manufacturedPrecision'], firstRegistration: ['firstRegistration', 'registrationPrecision'],
    registrationStatus: ['registrationStatus'], powertrain: ['powertrain'], body: ['body'], transmission: ['transmission'], location: ['country', 'city', 'locationName'],
  };
  for (const [key, keys] of Object.entries(factFields)) {
    if (unchanged(...keys)) Object.assign(result.facts, { [key]: structuredClone(base.facts[key as keyof typeof base.facts]) });
  }
  const includes = form.includes.split('\n').map((value) => value.trim()).filter(Boolean);
  result.price = form.priceKind === 'on_request' ? { kind: 'on_request', money: null, includes } : { kind: form.priceKind, money: { amount: form.amount.trim(), currency: form.currency }, includes };
  if (unchanged('priceKind', 'amount', 'currency', 'includes')) result.price = structuredClone(base.price);
  if (!unchanged('titleLanguage')) result.content.title.sourceLanguage = form.titleLanguage.trim();
  if (!unchanged('title')) result.content.title.sourceText = nullable(form.title);
  if (!unchanged('descriptionLanguage')) result.content.description.sourceLanguage = form.descriptionLanguage.trim();
  if (!unchanged('description')) result.content.description.sourceText = nullable(form.description);
  result.internal = { notes: nullable(form.notes), supplierContact: nullable(form.supplierContact), vin: nullable(form.vin), purchaseCost: form.purchaseAmount.trim() === '' ? null : { amount: form.purchaseAmount.trim(), currency: form.purchaseCurrency } };
  for (const key of ['notes', 'supplierContact', 'vin'] as const) if (unchanged(key)) result.internal[key] = base.internal[key];
  if (unchanged('purchaseAmount', 'purchaseCurrency')) result.internal.purchaseCost = structuredClone(base.internal.purchaseCost);
  if (base.source.kind === 'external') result.source = sourceForKind('external', form, base.source);
  return VehicleDraftInputSchema.parse(result);
}

export const fieldLabels: Record<keyof DraftForm, string> = {
  sourcePlatformId: '来源平台标识', sourcePlatformName: '来源平台名称', sourceListingUrl: '原始挂牌链接',
  sourceExternalId: '原始挂牌编号', sourceCollectedAt: '资料采集时间（UTC）', sourceUpdatedAt: '来源更新时间（UTC）',
  makeId: '品牌标识', makeName: '品牌名称', modelId: '车型标识', modelName: '车型名称', trimId: '配置标识', trimName: '配置名称',
  modelYear: '年款', mileageKm: '里程（公里）', engineCc: '排量（cc）', powerKw: '功率（kW）',
  manufacturedAt: '制造日期', manufacturedPrecision: '制造日期精度', firstRegistration: '首次登记日期', registrationPrecision: '首次登记日期精度',
  registrationStatus: '登记状态', powertrain: '动力类型', body: '车身形式', transmission: '变速箱',
  country: '所在地国家代码', city: '所在地城市', locationName: '公开所在地描述',
  priceKind: '公开价格口径', amount: '公开价格金额', currency: '公开价格币种', includes: '价格包含项目',
  titleLanguage: '标题原文语言', title: '标题原文', descriptionLanguage: '描述原文语言', description: '描述原文',
  purchaseAmount: '内部采购成本', purchaseCurrency: '采购成本币种', notes: '内部备注', supplierContact: '供应商联系方式', vin: 'VIN',
};

const pathFields: Record<string, keyof DraftForm> = {
  'source.platform.id': 'sourcePlatformId', 'source.platform.name': 'sourcePlatformName', 'source.listingUrl': 'sourceListingUrl',
  'source.externalId': 'sourceExternalId', 'source.collectedAt': 'sourceCollectedAt', 'source.sourceUpdatedAt': 'sourceUpdatedAt',
  'facts.make.id': 'makeId', 'facts.make.name': 'makeName', 'facts.model.id': 'modelId', 'facts.model.name': 'modelName',
  'facts.trim.id': 'trimId', 'facts.trim.name': 'trimName', 'facts.modelYear': 'modelYear', 'facts.mileageKm': 'mileageKm',
  'facts.engineCc': 'engineCc', 'facts.powerKw': 'powerKw', 'facts.manufacturedAt': 'manufacturedAt', 'facts.firstRegistration': 'firstRegistration',
  'facts.location.country': 'country', 'facts.location.city': 'city', 'facts.location.displayName': 'locationName',
  'price.money.amount': 'amount', 'price.money.currency': 'currency', 'price.includes': 'includes',
  'content.title.sourceLanguage': 'titleLanguage', 'content.title.sourceText': 'title',
  'content.description.sourceLanguage': 'descriptionLanguage', 'content.description.sourceText': 'description',
  'internal.purchaseCost.amount': 'purchaseAmount', 'internal.notes': 'notes', 'internal.supplierContact': 'supplierContact', 'internal.vin': 'vin',
};
export function fieldForPath(path: string): keyof DraftForm | undefined {
  const normalized = path.replace(/^draft\./, '');
  return Object.entries(pathFields).find(([prefix]) => normalized === prefix || normalized.startsWith(`${prefix}.`))?.[1];
}

export function formatTime(value: string | null): string {
  return value ? `${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))}（上海时间）` : '尚未记录';
}

export function changedFields(local: DraftForm, remote: DraftForm) {
  return (Object.keys(fieldLabels) as (keyof DraftForm)[]).filter((key) => local[key] !== remote[key]);
}
