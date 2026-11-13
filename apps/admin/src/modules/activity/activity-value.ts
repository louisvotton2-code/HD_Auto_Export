/** Display an authoritative audit value without conflating absence, null or falsy values. */
export function formatActivityValue(value: unknown, present = true): string {
  if (!present || value === undefined) return '未记录';
  if (value === null) return 'null（空值）';
  if (typeof value === 'number' && !Number.isFinite(value)) return '无法展示的值';
  if (value === '') return '""（空字符串）';
  try {
    return JSON.stringify(value, null, 2) ?? '无法展示的值';
  } catch {
    return '无法展示的值';
  }
}
