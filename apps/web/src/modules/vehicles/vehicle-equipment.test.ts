import { describe, expect, it } from 'vitest';
import { groupVehicleEquipment, ownershipTransfers } from './vehicle-equipment';

const field = (name: string, value: string) => ({
  name: { text: name, contentLocale: 'en' },
  value: { text: value, contentLocale: 'en' },
});

describe('vehicle detail groupings', () => {
  it('groups the published fields, translates known labels and keeps the original values', () => {
    const entries = [
      field('Blind spot monitoring', 'Optional'),
      field('座椅通风', '无'),
      field('batteryKwh', '73.3'),
      field('Unknown trim note', 'Contact seller'),
      field('Ownership transfers', '0'),
      field('ISOFIX child-seat anchors', 'standard'),
    ];
    const groups = groupVehicleEquipment(entries, 'zh');
    expect(groups.map(({ label }) => label)).toEqual(['舒适', '安全', '技术', '其他']);
    expect(groups[0]?.entries).toEqual([entries[1]]);
    expect(groups[1]?.entries).toEqual([entries[0], entries[5]]);
    expect(groups[2]?.entries[0]).toEqual({
      name: { text: '电池容量（kWh）', contentLocale: 'zh' },
      value: { text: '73.3', contentLocale: 'en' },
    });
    expect(groups[3]?.entries).toEqual([entries[3]]);
    expect(ownershipTransfers(entries)).toBe('0');
  });

  it('omits unreported categories and never invents a transfer count', () => {
    const entry = field('Ownership transfers', 'Not supplied');
    expect(ownershipTransfers([entry])).toBeUndefined();
    expect(groupVehicleEquipment([entry], 'en')).toEqual([
      { group: 'other', label: 'Other', entries: [entry] },
    ]);
    expect(groupVehicleEquipment([], 'ru')).toEqual([]);
  });

  it('keeps conflicting counts in the original specifications instead of asserting a history value', () => {
    const entries = [field('Ownership transfers', '1'), field('过户次数', '2')];
    expect(ownershipTransfers(entries)).toBeUndefined();
    expect(groupVehicleEquipment(entries, 'en')[0]?.entries).toEqual(entries);
    expect(ownershipTransfers([entries[0]!, entries[0]!])).toBe('1');
  });

  it('recognizes child-seat anchors and seat-belt reminders before matching comfort', () => {
    const entries = ['child-seat anchors', 'seat-belt reminder', '儿童座椅固定装置', 'Крепление детского сиденья']
      .map((name) => field(name, 'standard'));
    expect(groupVehicleEquipment(entries, 'zh')).toEqual([{ group: 'safety', label: '安全', entries }]);
  });
});
