import {
  configurationImportExample, vehicleConfigurationItemId, VEHICLE_CONFIGURATION_LIMITS,
  type ConfigurationImportDocument, type VehicleConfiguration,
} from '@hd/contracts/admin';
import { powertrainLabels, type DraftForm } from './draft-form';

export const importExampleText = JSON.stringify(configurationImportExample, null, 2);
export const importLocaleLabels = { zh: '中文', en: '英文', ru: '俄文' };
export type ImportLocale = keyof typeof importLocaleLabels;

export function configurationImportPrompt(form: DraftForm, saved: VehicleConfiguration | null | undefined) {
  const known = Object.fromEntries([
    ['品牌', form.makeName], ['车型', form.modelName], ['配置款型', form.trimName], ['年款', form.modelYear],
    ['标题', form.title], ['车况描述', form.description],
    ['动力类型', form.powertrain === 'unknown' ? '' : powertrainLabels[form.powertrain]],
  ].filter(([, text]) => text.trim()));
  return `将我提供且已核实的资料整理成一个可下载的 UTF-8 JSON 文件，包含中文 zh、英文 en 和俄文 ru。
只使用我提供的事实。不要查询或补写缺失参数，不猜测年款、动力、价格、颜色、装备或车况。保留数字、型号、单位、标配和选装语义。信息不足时省略相应字段；如果没有可整理的资料，请先告诉我还需要提供什么。
只输出一个 JSON 对象或一个 .json 文件。结构如示例，version 为数字 1。不要输出 Markdown 代码块、解释、重复属性、身份编号或内部资料。
items、content、display、facts 都可省略，但至少包含一个。每个提供的名称、参数或正文都要填写 zh、en、ru，三个值都是非空字符串。
items 代表整份配置，最多 ${VEHICLE_CONFIGURATION_LIMITS.items} 项。如果只改正文，不要输出 items。中文项目名、值与已核实事实保持一致。每个 id 由 cfg- 加上中文 name.zh 的每个 UTF-16 单元的四位小写十六进制顺序拼接，请用代码计算。中文值不含汉字时，三个语言的值必须原样一致。
content 只包含已提供的 title、description。display 只使用我另行提供的现有字段 ref；没有 ref 时省略 display。
只有明确提供动力类型时才填 facts.powertrain：汽油 petrol、柴油 diesel、油电混动 hev、插电混动 phev、增程 erev、纯电 bev、液化石油气 lpg、其他 other。无法确认时省略 facts。
如果不同来源或配置款型有冲突，请先向我确认。不要把示例值复制进实际文件。

结构示例：
${importExampleText}

当前车辆的已填资料：
${JSON.stringify(known)}
${saved ? `\n已保存的完整配置（如输出 items，请保留仍适用的项目）：\n${JSON.stringify(saved.items)}` : '\n请等待我提供已核实的配置参数。'}`;
}

type IssuePath = readonly PropertyKey[];
export function importPath(path: IssuePath): string {
  if (!path.length) return '$';
  return path.reduce<string>((result, part) => typeof part === 'number' ? `${result}[${part}]` : result ? `${result}.${String(part)}` : String(part), '');
}

function issueDetail(message: string) {
  if (message.includes('Duplicate JSON property')) return '对象内有重复属性。';
  if (message.includes('strict JSON')) return '请粘贴完整标准 JSON，移除代码块和说明文字。';
  if (message.includes('Item ID')) return 'ID 必须唯一，并与中文名称一致。';
  if (message.includes('same literal')) return '数值、单位或型号请在三语中保留相同文字。';
  if (message.includes('nonblank') || message.includes('regex')) return '请填写非空字符串，检查首尾空格。';
  if (message.includes('names must be unique')) return '中文配置名称不能重复。';
  if (message.includes('At least one')) return '请提供配置、标题／车况或其他公开字段中的至少一项。';
  return message;
}

export function configurationImportIssues(failure: unknown): { path: string; message: string }[] {
  if (failure && typeof failure === 'object' && 'issues' in failure && Array.isArray(failure.issues)) {
    return failure.issues.map(({ path, message }: { path: IssuePath; message: string }) => ({ path: importPath(path), message: issueDetail(message) }));
  }
  return [];
}

export function editImportItem(document: ConfigurationImportDocument, index: number, key: 'name' | 'value', locale: ImportLocale, text: string) {
  const item = document.items?.[index];
  if (!item) return;
  item[key][locale] = text;
  if (key === 'name' && locale === 'zh') {
    try { item.id = vehicleConfigurationItemId(text); }
    catch { /* Intermediate invalid input remains editable and is caught on preview. */ }
  }
}
