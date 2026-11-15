import { VehicleFactsSchema, type VehicleConfiguration } from '@hd/contracts/admin';
import { powertrainLabels, type DraftForm } from './draft-form';

const measurement = {
  '排量(cc)': 'engineCc',
  '功率(kw)': 'powerKw',
  '原始马力(hp)': 'powerHp',
} as const;
const transmission = {
  手动: 'manual', 自动: 'automatic', 无级变速: 'cvt', 双离合: 'dct', 其他: 'other',
} as const;
const body = {
  掀背: 'hatchback', SUV: 'suv', 轿车: 'sedan', 旅行车: 'wagon', 轿跑: 'coupe',
  敞篷: 'convertible', 厢式车: 'van', 皮卡: 'pickup', 其他: 'other',
} as const;
export const configurationPowertrainOptions = Object.entries(powertrainLabels)
  .filter(([value]) => value !== 'unknown')
  .map(([value, label]) => ({ value: value as Exclude<DraftForm['powertrain'], 'unknown'>, label }));

type Field = 'powertrain' | 'engineCc' | 'powerKw' | 'powerHp' | 'transmission' | 'body';
type Fields = Partial<Pick<DraftForm, Field>>;

/** Only the documented names and units can change structured vehicle facts. */
export function readConfigurationFacts(
  rows: VehicleConfiguration['items'], previousRows: VehicleConfiguration['items'] = [],
) {
  const fields: Fields = {};
  const labels: Partial<Record<Field, string>> = {};
  const errors: string[] = [];
  for (const row of rows) {
    // Match the comparison key used by VehicleConfigurationSchema for names.
    const name = row.name.normalize('NFKC').trim().toLowerCase();
    if (Object.hasOwn(measurement, name)) {
      const key = measurement[name as keyof typeof measurement];
      const number = Number(row.value);
      if (!/^\d+(?:\.\d+)?$/.test(row.value) || !VehicleFactsSchema.shape[key].safeParse(number).success) {
        errors.push(`${row.name}须使用名称中的单位，数值不另加单位`);
      } else {
        fields[key] = String(number);
        labels[key] = row.value;
      }
    } else if (name === '动力类型') {
      // An unchanged historical row can differ from the stored powertrain.
      if (previousRows.some(previous => previous.name.normalize('NFKC').trim() === name && previous.value === row.value)) continue;
      const option = configurationPowertrainOptions.find(({ label }) => label === row.value);
      if (option) {
        fields.powertrain = option.value;
        labels.powertrain = option.label;
      } else errors.push('动力类型须使用提示词中的标准值，未知时省略');
    } else if (name === '变速箱') {
      const value = transmission[row.value as keyof typeof transmission];
      if (Object.hasOwn(transmission, row.value)) {
        fields.transmission = value;
        labels.transmission = row.value;
      } else errors.push('变速箱须使用提示词中的标准值');
    } else if (name === '车身形式') {
      const value = body[row.value as keyof typeof body];
      if (Object.hasOwn(body, row.value)) {
        fields.body = value;
        labels.body = row.value;
      } else errors.push('车身形式须使用提示词中的标准值');
    }
  }
  return { fields, labels, errors };
}
