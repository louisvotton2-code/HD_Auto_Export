import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CONFIGURATION_SEMANTIC_FIXTURES, makePublicExternalVehicleFixture, makePublicVehicleFixture } from '@hd/contracts/fixtures';
import { CONFIGURATION_SEMANTIC_KEYS, type ConfigurationSemanticKey, type DisplayText, type PublicVehicle, type PublicVehicleInline } from '@hd/contracts/public';
import { equipmentIconName } from './equipment-icon';
import { equipmentIconSvg, type EquipmentIconName } from './equipment-icon-svg';
import { PublicVehicleConfiguration } from './ui/public-vehicle-configuration';
import { VehicleConfiguration } from './ui/vehicle-configuration';
import { VehicleEquipment } from './ui/vehicle-equipment';

const text = (value: string): DisplayText => ({
  status: 'ready', text: value, requestedLocale: 'zh', contentLocale: 'zh', provenance: 'human', reviewed: true,
});

function inlineVehicle(base: PublicVehicle, items: PublicVehicleInline['configurationInline']): PublicVehicleInline {
  return {
    ...base, projection: 'detail-inline-v1', configurationInline: items,
    inspectionSummary: { status: 'no_report', contentLocale: null, checked: null, faults: null, categories: [] },
    inspectionInline: { conclusions: [], defects: [], normalItemCount: 0, hasMoreConclusions: false, hasMoreDefects: false },
  };
}

describe('item equipment icon semantics', () => {
  it.each([
    ['seat', 'Leather seats', '真皮座椅', 'Кожаные сиденья'],
    ['seat-heating', 'Heated front seats', '前排座椅加热', 'Подогрев передних сидений'],
    ['seat-ventilation', 'Ventilated driver seat', '主驾驶座椅通风', 'Вентиляция сиденья водителя'],
    ['seat-memory', 'Driver seat memory', '驾驶位座椅记忆', 'Память сиденья водителя'],
    ['climate', 'Automatic climate control', '自动空调', 'Автоматический климат-контроль'],
    ['cruise-control', 'Adaptive cruise control', '自适应巡航', 'Адаптивный круиз-контроль'],
    ['parking-sensors-front', 'Front parking sensors', '前驻车雷达', 'Передние парктроники'],
    ['parking-sensors-rear', 'Rear parking sensors', '后驻车雷达', 'Задние парктроники'],
    ['tire-pressure', 'Tire pressure monitoring (TPMS)', '胎压监测', 'Контроль давления в шинах'],
    ['camera', 'Rear-view camera', '倒车影像', 'Камера заднего вида'],
    ['navigation', 'Navigation', '导航', 'Навигация'],
    ['bluetooth', 'Bluetooth', '蓝牙', 'Блютус'],
    ['smart-key', 'Smart key', '智能钥匙', 'Смарт-ключ'],
    ['rain-sensor', 'Rain sensor', '雨量感应', 'Датчик дождя'],
    ['engine', 'Engine power (kW)', '发动机功率（kW）', 'Мощность двигателя (кВт)'],
    ['motor', 'Motor power (kW)', '电机功率（kW）', 'Мощность электромотора (кВт)'],
    ['battery', 'Battery capacity (kWh)', '电池容量（kWh）', 'Ёмкость батареи (кВт·ч)'],
    ['drivetrain', 'Drive type', '驱动形式', 'Тип привода'],
    ['dimensions', 'Wheelbase (mm)', '轴距（mm）', 'Колёсная база (мм)'],
    ['door', 'Doors', '车门数', 'Двери'],
    ['wheel', 'Alloy wheels', '铝合金轮毂', 'Легкосплавные диски'],
    ['stability-control', 'Traction control (TCS)', '牵引力控制', 'Антипробуксовочная система'],
  ])('keeps %s stable across three-language labels', (expected, ...labels) => {
    for (const label of labels) expect(equipmentIconName(label)).toBe(expected);
  });

  it('uses explicit semantics before a fallback label and never guesses from source identities', () => {
    for (const label of ['Other feature', '其他配置', 'Другая опция']) {
      expect(equipmentIconName(label, 'supplier:frontSeatHeating', 'frontSeatHeating')).toBe('seat-heating');
      expect(equipmentIconName(label, 'supplier:frontSeatHeating')).toBe('neutral');
    }
    expect(equipmentIconName('Unmapped calibration feature', 'f4571316-18ed-4aba-9f98-87df8400abcd')).toBe('neutral');
    expect(equipmentIconName(null)).toBe('neutral');
    expect(equipmentIconName(null, 'frontSeatHeating')).toBe('seat-heating');
    expect(equipmentIconName(null, 'opaque:frontSeatHeating')).toBe('neutral');
    expect(equipmentIconName(null, 'frontSeatHeating', null)).toBe('neutral');
  });

  it('handles feature qualifiers without switching to a group icon', () => {
    expect(equipmentIconName('前排座椅通风（三级）')).toBe('seat-ventilation');
    expect(equipmentIconName('Вентилируемые передние сиденья')).toBe('seat-ventilation');
    expect(equipmentIconName('Обогрев передних сидений')).toBe('seat-heating');
    expect(equipmentIconName('Adaptive cruise control with stop and go')).toBe('cruise-control');
    expect(equipmentIconName('Система контроля давления в шинах (TPMS)')).toBe('tire-pressure');
  });

  it('keeps wheel geometry distinct from TPMS and toll systems distinct from keyless entry', () => {
    for (const label of ['Alloy wheels', '铝合金轮毂', 'Легкосплавные диски']) {
      expect(equipmentIconName(label)).toBe('wheel');
    }
    for (const label of ['Hi-Pass toll system', 'ETC', '自动收费系统']) {
      expect(equipmentIconName(label)).toBe('neutral');
    }
    expect(equipmentIconName('Tire pressure monitoring (TPMS)', 'supplier:alloyWheels', 'alloyWheels')).toBe('wheel');
    expect(equipmentIconName('Keyless entry', 'supplier:hiPass', 'hiPass')).toBe('neutral');
    expect(equipmentIconName('胎压监测', 'supplier:tpms')).toBe('tire-pressure');
    expect(equipmentIconName('无钥匙进入', 'supplier:keylessEntry')).toBe('keyless-entry');
  });

  it.each([
    ['displacementCc', 'engine'], ['engineKw', 'engine'], ['engineHp', 'engine'], ['motorKw', 'motor'], ['motorHp', 'motor'],
    ['batteryKwh', 'battery'], ['driveType', 'drivetrain'], ['lengthMm', 'dimensions'],
    ['widthMm', 'dimensions'], ['heightMm', 'dimensions'], ['wheelbaseMm', 'dimensions'],
    ['doors', 'door'], ['alloyWheels', 'wheel'], ['airbags', 'driver-airbag'], ['abs', 'abs'], ['tractionControl', 'stability-control'], ['parkingCamera', 'camera'],
  ])('uses authoritative %s independently of language, fallback name or opaque id', (semanticKey, expected) => {
    for (const label of ['其他配置', 'Other feature', 'Другая опция', 'Tire pressure monitoring (TPMS)']) {
      expect(equipmentIconName(label, 'supplier:frontSeatHeating', semanticKey)).toBe(expected);
    }
  });

  it('does not infer a known glyph when a non-null inline semantic key is unknown', () => {
    for (const semanticKey of ['futureSupplierFeature', 'constructor', 'toString']) {
      expect(equipmentIconName('座椅加热', 'frontSeatHeating', semanticKey)).toBe('neutral');
    }
  });

  it.each([
    ['seat-heating', '座椅加热', 'Heated seats', 'Подогрев сидений'],
    ['seat-ventilation', '座椅通风', 'Ventilated seats', 'Вентиляция сидений'],
    ['tire-pressure', '胎压监测', 'Tire pressure monitoring (TPMS)', 'Контроль давления в шинах'],
    ['navigation', '导航', 'Navigation', 'Навигация'],
    ['engine', '发动机马力', 'Engine horsepower', 'Мощность двигателя (л.с.)'],
    ['motor', '电机马力', 'Motor horsepower', 'Мощность электромотора (л.с.)'],
    ['camera', '倒车影像', 'Parking camera', 'Камера заднего вида'],
  ])('uses vetted %s labels when a stored projection has no semantic key', (expected, ...labels) => {
    for (const label of labels) for (const key of [null, undefined]) {
      expect(equipmentIconName(label, 'opaque-id', key)).toBe(expected);
    }
    expect(equipmentIconName('Unmapped calibration feature', 'supplier:frontSeatHeating', null)).toBe('neutral');
    expect(equipmentIconName('Unmapped calibration feature', 'opaque:frontSeatHeating', undefined)).toBe('neutral');
  });

  it.each([
    'No heated seats', 'May have navigation', 'Heated seats not confirmed',
    '不带座椅加热', '可能有胎压监测', '导航待确认',
    'Без подогрева сидений', 'Возможно есть подогрев сидений', 'Навигация не подтверждена',
  ])('keeps a negative/uncertain fallback label neutral: %s', label => {
    for (const key of [null, undefined]) {
      expect(equipmentIconName(label, 'frontSeatHeating', key)).toBe('neutral');
      expect(equipmentIconName(label, 'supplier:frontSeatHeating', key)).toBe('neutral');
    }
  });

  it('consumes the shared BE semantic examples consistently across all three labels', () => {
    const expected: Partial<Record<ConfigurationSemanticKey, EquipmentIconName>> = {
      frontSeatHeating: 'seat-heating', rearSeatHeating: 'seat-heating',
      seatVentilation: 'seat-ventilation', frontSeatVentilation: 'seat-ventilation',
      driverSeatVentilation: 'seat-ventilation', passengerSeatVentilation: 'seat-ventilation',
      seatMemory: 'seat-memory', navigation: 'navigation', tpms: 'tire-pressure',
      parkingCamera: 'camera', engineHp: 'engine', motorHp: 'motor', motorKw: 'motor', adaptiveCruiseControl: 'cruise-control',
    };
    for (const fixture of CONFIGURATION_SEMANTIC_FIXTURES) {
      const icon = fixture.semanticKey === null ? 'neutral' : expected[fixture.semanticKey];
      expect(icon).toBeDefined();
      for (const label of fixture.labels) expect(equipmentIconName(label, fixture.id, fixture.semanticKey)).toBe(icon);
    }
    // Every producer key must point to renderable local geometry, including deliberately neutral parameters.
    for (const key of CONFIGURATION_SEMANTIC_KEYS) {
      expect(Object.hasOwn(equipmentIconSvg, equipmentIconName('Unknown label', 'opaque-id', key))).toBe(true);
    }
  });

  it('renders the same item geometry for structured and legacy configuration entries, retaining false and zero', () => {
    const text = (value: string) => ({
      status: 'ready' as const, text: value, requestedLocale: 'zh' as const,
      contentLocale: 'zh' as const, provenance: 'human' as const, reviewed: true,
    });
    const structured = renderToStaticMarkup(createElement(VehicleConfiguration, {
      locale: 'zh', configuration: { version: 1, items: [
        { id: 'frontSeatHeating', name: text('前排座椅加热'), value: text('false') },
        { id: 'unknown-field', name: text('未映射配置'), value: text('0') },
      ] },
    }));
    const legacy = renderToStaticMarkup(createElement(VehicleEquipment, {
      locale: 'ru', title: 'Комплектация', specifications: [
        { name: { text: 'Подогрев передних сидений', contentLocale: 'ru' }, value: { text: 'false', contentLocale: 'ru' } },
        { name: { text: 'Неизвестная опция', contentLocale: 'ru' }, value: { text: '0', contentLocale: 'ru' } },
      ],
    }));
    for (const markup of [structured, legacy]) {
      expect(markup.match(/data-equipment-icon="seat-heating"/g)).toHaveLength(1);
      expect(markup.match(/data-equipment-icon="neutral"/g)).toHaveLength(1);
      expect(markup).toContain('false');
      expect(markup).toMatch(/>0</);
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).not.toMatch(/<script|<foreignObject|<image|<use|xlink:|data:image/);
      expect(markup.match(/<details/g)).toHaveLength(1);
      expect(markup).not.toContain('data-equipment-group');
      expect(markup).toContain('data-vehicle-parameters');
    }
    expect(structured).toContain('车辆参数与配置');
    expect(legacy).toContain('Характеристики и комплектация');
  });

  it.each([makePublicVehicleFixture, makePublicExternalVehicleFixture])('renders either source through the same bounded inline grid', (makeBase) => {
    const vehicle = inlineVehicle(makeBase(), [
      { id: 'first', semanticKey: 'motorKw', name: text('电机功率（kW）'), value: text('0 kW') },
      { id: 'second', semanticKey: null, name: text('<script>未知配置</script>'), value: text('false') },
    ]);
    vehicle.configuration = { version: 1, items: [{ id: 'cfg-0061', name: text('旧路径配置'), value: text('不要重复显示') }] };
    const markup = renderToStaticMarkup(createElement(PublicVehicleConfiguration, { vehicle, locale: 'zh' }));
    expect(markup.match(/data-vehicle-parameters/g)).toHaveLength(1);
    expect([...markup.matchAll(/data-configuration-item="([^"]+)"/g)].map((match) => match[1])).toEqual(['first', 'second']);
    expect(markup).toContain('data-equipment-icon="motor"');
    expect(markup).toContain('data-equipment-icon="neutral"');
    expect(markup).toContain('0 kW');
    expect(markup).toContain('false');
    expect(markup).toContain('&lt;script&gt;未知配置&lt;/script&gt;');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('旧路径配置');
    expect(markup).not.toContain('data-equipment-group');
  });

  it('does not fall back to a larger old payload for empty or unready inline fields', () => {
    const vehicle = inlineVehicle(makePublicVehicleFixture(), []);
    vehicle.configuration = { version: 1, items: [{ id: 'cfg-0061', name: text('旧路径配置'), value: text('不要回退') }] };
    expect(renderToStaticMarkup(createElement(PublicVehicleConfiguration, { vehicle, locale: 'zh' }))).toBe('');
    vehicle.configurationInline = [{
      id: 'missing', semanticKey: 'doors', name: text('车门数'),
      value: { status: 'missing', text: null, requestedLocale: 'zh', contentLocale: null, provenance: null, reviewed: false },
    }];
    expect(renderToStaticMarkup(createElement(PublicVehicleConfiguration, { vehicle, locale: 'zh' }))).toBe('');
  });
});
