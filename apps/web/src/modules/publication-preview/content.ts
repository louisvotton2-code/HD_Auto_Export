import type { Locale } from '@/i18n/routing';

export const previewContent = {
  zh: {
    title: '车辆发布预览', loading: '正在读取员工预览…', reloadInAdmin: '请在后台点击“重新载入预览”，打开新的预览实例。',
    version: '草稿版本', revision: '公开内容版本',
    note: '请在后台核对三语内容并明确确认当前版本。',
    errors: {
      unauthenticated: '登录已失效，请返回后台重新登录。',
      forbidden: '当前账号没有查看这份预览的权限。',
      not_found: '车辆或预览资料不存在。',
      conflict: '车辆已更新，请从后台打开最新预览。',
      invalid_response: '预览资料与当前车辆或语言不一致，请重新读取。',
      unavailable: '预览暂时无法读取，请稍后重试。',
      render_error: '预览未能完整显示，请重新读取。',
      invalid_request: '预览链接无效，请从后台重新打开。',
    },
  },
  en: {
    title: 'Vehicle publication preview', loading: 'Loading staff preview…', reloadInAdmin: 'Use “Reload preview” in the admin to open a new preview instance.',
    version: 'Draft version', revision: 'Public content revision',
    note: 'Review the language content and explicitly confirm this version in the admin.',
    errors: {
      unauthenticated: 'Your session has expired. Sign in again in the admin.',
      forbidden: 'Your account cannot access this preview.',
      not_found: 'The vehicle or preview could not be found.',
      conflict: 'The vehicle has changed. Open the latest preview from the admin.',
      invalid_response: 'The preview does not match this vehicle or language. Reload it.',
      unavailable: 'The preview is unavailable. Please try again.',
      render_error: 'The preview could not be fully displayed. Please reload it.',
      invalid_request: 'This preview link is invalid. Open a new preview from the admin.',
    },
  },
  ru: {
    title: 'Предпросмотр публикации', loading: 'Загружается предпросмотр…', reloadInAdmin: 'Нажмите «Перезагрузить предпросмотр» в панели управления, чтобы открыть новый экземпляр.',
    version: 'Версия черновика', revision: 'Версия публичного содержимого',
    note: 'Проверьте языковые версии и подтвердите эту версию в панели управления.',
    errors: {
      unauthenticated: 'Сеанс истёк. Войдите снова в панели управления.',
      forbidden: 'У вашей учётной записи нет доступа к этому предпросмотру.',
      not_found: 'Автомобиль или предпросмотр не найден.',
      conflict: 'Автомобиль обновлён. Откройте актуальный предпросмотр из панели управления.',
      invalid_response: 'Данные не соответствуют автомобилю или языку. Загрузите их заново.',
      unavailable: 'Предпросмотр временно недоступен. Повторите попытку.',
      render_error: 'Не удалось полностью отобразить предпросмотр. Загрузите его заново.',
      invalid_request: 'Недействительная ссылка. Откройте новый предпросмотр из панели управления.',
    },
  },
} satisfies Record<Locale, { title: string; loading: string; reloadInAdmin: string; version: string; revision: string; note: string; errors: Record<string, string> }>;
