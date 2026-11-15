import { vehicleConfigurationItemId, CONFIGURATION_TRANSLATION_CATALOG_VERSION } from '@hd/contracts/admin';

export { CONFIGURATION_TRANSLATION_CATALOG_VERSION };
type Target = 'en' | 'ru';

export const isConfigurationCatalogEngine = (engineVersion: string | null) => engineVersion?.startsWith('config-catalog:') ?? false;

const labels = new Map<string, Record<Target, string>>([
  ['整车OTA升级', { en: 'Whole-vehicle over-the-air update', ru: 'Обновление всего автомобиля по воздуху' }],
  ['官方0-100km/h加速时间(s)', { en: 'Official 0-100 km/h acceleration time (s)', ru: 'Официальное время разгона 0–100 км/ч (с)' }],
  ['直流快充最大功率(kW)', { en: 'Maximum DC fast charging power (kW)', ru: 'Максимальная мощность быстрой зарядки постоянным током (кВт)' }],
  ['家用交流充电功率(kW)', { en: 'Home AC charging power (kW)', ru: 'Мощность домашней зарядки переменным током (кВт)' }],
  ['长度(mm)', { en: 'Length (mm)', ru: 'Длина (мм)' }],
  ['宽度(mm)', { en: 'Width (mm)', ru: 'Ширина (мм)' }],
  ['高度(mm)', { en: 'Height (mm)', ru: 'Высота (мм)' }],
  ['轴距(mm)', { en: 'Wheelbase (mm)', ru: 'Колёсная база (мм)' }],
  ['动力电池容量(kWh)', { en: 'Traction battery capacity (kWh)', ru: 'Ёмкость тяговой батареи (кВт·ч)' }],
]);

/** Only the exact source name and its generated configuration identity are eligible. */
export function configurationCatalogText(ref: string, sourceText: string, target: Target): string | undefined {
  const entry = labels.get(sourceText);
  return entry && ref === `configuration.${vehicleConfigurationItemId(sourceText)}.name` ? entry[target] : undefined;
}
