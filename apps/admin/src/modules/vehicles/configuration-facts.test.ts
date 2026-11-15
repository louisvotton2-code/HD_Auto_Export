import { describe, expect, it } from 'vitest';
import { readConfigurationFacts } from './configuration-facts';

describe('structured configuration facts', () => {
  it('preserves explicit zero, recognizes normalized units and leaves unavailable horsepower unset', () => {
    const result = readConfigurationFacts([
      { name: '排量（cc）', value: '0' },
      { name: '功率(kW)', value: '84.50' },
      { name: '变速箱', value: '无级变速' },
      { name: '马力(PS)', value: '120' },
    ]);
    expect(result.fields).toEqual({ engineCc: '0', powerKw: '84.5', transmission: 'cvt' });
    expect(result.errors).toEqual([]);
  });

  it.each(['功率(kW)', '功率(kw)', '功率（ＫＷ）'])('recognizes %s as the same validated unit', name => {
    expect(readConfigurationFacts([{ name, value: '85' }]).fields).toEqual({ powerKw: '85' });
  });

  it('rejects malformed known measurements and leaves unrecognized display rows alone', () => {
    const result = readConfigurationFacts([
      { name: '排量(cc)', value: '1.5' },
      { name: '原始马力(hp)', value: '150 PS' },
      { name: '变速箱', value: '未知' },
      { name: '车身形式', value: 'SUV' },
      { name: '选装件', value: '未知' },
    ]);
    expect(result.fields).toEqual({ body: 'suv' });
    expect(result.errors).toHaveLength(3);
  });
});

it('imports an explicit powertrain and rejects guessed or unsupported values', () => {
  expect(readConfigurationFacts([{ name: '动力类型', value: '插电混动' }]).fields).toEqual({ powertrain: 'phev' });
  expect(readConfigurationFacts([{ name: '动力类型', value: '混动' }]).errors).toHaveLength(1);
  expect(readConfigurationFacts([]).fields).not.toHaveProperty('powertrain');
  const legacy = [{ name: '动力类型', value: '历史自由文本动力' }];
  expect(readConfigurationFacts([...legacy, { name: '挡位数', value: '8' }], legacy)).toEqual({ fields: {}, labels: {}, errors: [] });
  expect(readConfigurationFacts([{ name: '动力类型', value: '混动' }], legacy).errors).toHaveLength(1);
  const standard = [{ name: '动力类型', value: '汽油' }];
  expect(readConfigurationFacts(standard, standard).fields).not.toHaveProperty('powertrain');
  expect(readConfigurationFacts(standard, legacy).fields).toEqual({ powertrain: 'petrol' });
});
