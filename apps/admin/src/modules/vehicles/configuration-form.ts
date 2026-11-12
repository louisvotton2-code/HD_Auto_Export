import { parseVehicleConfigurationJson, VEHICLE_CONFIGURATION_LIMITS, type VehicleConfiguration } from '@hd/contracts/admin';

type InputIssue = { code?: unknown; path?: unknown; message?: unknown; expected?: unknown };
export type ConfigurationFormState = { value: VehicleConfiguration | null; errors: string[] };

export function configurationToText(configuration: VehicleConfiguration | null | undefined): string {
  return configuration ? JSON.stringify(configuration, null, 2) : '';
}

/** Empty text explicitly clears a draft; nonempty text always uses the shared strict parser. */
export function configurationFromText(raw: string): VehicleConfiguration | null {
  return raw.trim() ? parseVehicleConfigurationJson(raw) : null;
}

function issueLabel(issue: InputIssue): string {
  const path = Array.isArray(issue.path) ? issue.path : [];
  const property = path.at(-1);
  const itemIndex = path[0] === 'items' && typeof path[1] === 'number' ? path[1] : null;
  const prefix = itemIndex === null ? property === 'version' ? '格式版本：' : '配置内容：'
    : `第 ${itemIndex + 1} 项${property === 'name' ? '名称' : property === 'value' ? '内容' : ''}：`;
  const text = typeof issue.message === 'string' ? issue.message : '';
  const limits = VEHICLE_CONFIGURATION_LIMITS;
  let detail: string;
  if (text.includes('Duplicate JSON property')) detail = '同一个对象不能重复填写同名属性，请按示例只保留一份。';
  else if (text.includes('names must be unique')) detail = '配置名称重复；全角／半角和字母大小写视为相同，请合并或更名。';
  else if (text.includes('Combined name and value length')) detail = `名称和内容的总长度不得超过 ${limits.totalUtf16.toLocaleString('zh-CN')} 个字符。`;
  else if (text.includes('UTF-8 bytes')) detail = `粘贴文本不能超过 ${limits.jsonBytes / 1024} KB，请自行精简后重新粘贴。`;
  else if (text.includes('nested too deeply') || text.includes('too many values')) detail = '层级或结构不符合标准，请按示例整理为配置项目列表。';
  else if (text.includes('strict JSON') || text.includes('Unterminated')) detail = '只支持标准 JSON，请移除代码块及解释文字，使用英文双引号和英文标点。';
  else if (issue.code === 'unrecognized_keys') detail = '出现未规定的属性；顶层只能有 version、items，每项只能有 name、value。';
  else if (property === 'version') detail = 'version 必须是数字 1。';
  else if (issue.code === 'invalid_type') detail = issue.expected === 'string' ? '必须填写字符串，数值也要使用英文双引号。'
    : issue.expected === 'array' ? 'items 必须是数组。' : '请按示例填写 JSON 对象。';
  else if (issue.code === 'too_big') detail = property === 'name' ? `名称不得超过 ${limits.nameUtf16} 个字符。`
    : property === 'value' ? `内容不得超过 ${limits.valueUtf16} 个字符。` : `配置最多填写 ${limits.items} 项。`;
  else if (issue.code === 'too_small') detail = property === 'items' ? '至少填写一项有依据的配置。' : '不能为空。';
  else if (issue.code === 'invalid_format') detail = '不能为空，且首尾不能留空白字符。';
  else detail = '格式不符合标准，请参考下方正确格式示例。';
  return prefix + detail;
}

export function configurationFormState(raw: string): ConfigurationFormState {
  try { return { value: configurationFromText(raw), errors: [] }; }
  catch (failure) {
    const issues = failure && typeof failure === 'object' && 'issues' in failure && Array.isArray(failure.issues)
      ? failure.issues as InputIssue[] : [];
    const errors = [...new Set(issues.map(issueLabel))];
    return { value: null, errors: errors.length ? errors.slice(0, 8) : ['配置内容：格式不符合标准，请参考下方正确格式示例。'] };
  }
}
