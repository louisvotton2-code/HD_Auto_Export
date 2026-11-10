'use client';
import { useLocale } from 'next-intl';

const copy = {
  zh: ['暂时无法读取车辆信息', '车辆服务暂时不可用，请稍后重试。', '重新加载'],
  en: [
    'Vehicle information unavailable',
    'The vehicle service is temporarily unavailable. Please try again.',
    'Reload',
  ],
  ru: [
    'Информация об автомобиле недоступна',
    'Сервис временно недоступен. Повторите попытку позже.',
    'Обновить',
  ],
} as const;
export default function VehicleError() {
  const locale = useLocale() as keyof typeof copy;
  const t = copy[locale] ?? copy.ru;
  return (
    <main id="main" style={{ maxWidth: 900, margin: '120px auto 80px', padding: 24 }}>
      <h1>{t[0]}</h1>
      <p>{t[1]}</p>
      <a href="">{t[2]}</a>
    </main>
  );
}
