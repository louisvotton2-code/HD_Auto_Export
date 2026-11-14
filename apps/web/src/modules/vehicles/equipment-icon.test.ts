import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { equipmentIconName } from './equipment-icon';
import { VehicleConfiguration } from './ui/vehicle-configuration';
import { VehicleEquipment } from './ui/vehicle-equipment';

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
  ])('keeps %s stable across three-language labels', (expected, ...labels) => {
    for (const label of labels) expect(equipmentIconName(label)).toBe(expected);
  });

  it('uses a known stable field ID before a fallback label and never guesses from arbitrary IDs', () => {
    for (const label of ['Other feature', '其他配置', 'Другая опция']) {
      expect(equipmentIconName(label, 'supplier:frontSeatHeating')).toBe('seat-heating');
    }
    expect(equipmentIconName('Unmapped calibration feature', 'f4571316-18ed-4aba-9f98-87df8400abcd')).toBe('neutral');
    expect(equipmentIconName(null)).toBe('neutral');
  });

  it('handles feature qualifiers without switching to a group icon', () => {
    expect(equipmentIconName('前排座椅通风（三级）')).toBe('seat-ventilation');
    expect(equipmentIconName('Вентилируемые передние сиденья')).toBe('seat-ventilation');
    expect(equipmentIconName('Обогрев передних сидений')).toBe('seat-heating');
    expect(equipmentIconName('Adaptive cruise control with stop and go')).toBe('cruise-control');
    expect(equipmentIconName('Система контроля давления в шинах (TPMS)')).toBe('tire-pressure');
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
    }
  });
});
