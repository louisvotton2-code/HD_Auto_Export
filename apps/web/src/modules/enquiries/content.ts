import type { Locale } from '@/i18n/routing';

export const enquiryContent = {
  zh: {
    title: '留下咨询信息',
    intro: '告诉我们你的需求，与 HD Auto Export 联系。',
    name: '你的姓名', phone: '联系电话', message: '备注或意向车型',
    method: '希望通过哪种方式联系？', username: 'Telegram 用户名',
    submit: '打开咨询草稿', close: '关闭咨询窗口',
    note: '姓名、电话和需求将预填到所选聊天工具，由你确认后发送。',
    draft: '你好，我想了解汽车出口或配件采购。',
    page: '咨询页面',
  },
  en: {
    title: 'Leave a Request',
    intro: 'Tell HD Auto Export what you are looking for.',
    name: 'Your name', phone: 'Phone number', message: 'Comment or car model',
    method: 'How should we contact you?', username: 'Telegram username',
    submit: 'Open enquiry draft', close: 'Close enquiry',
    note: 'Your name, phone and request will be prefilled in your chosen chat. Review and send it there.',
    draft: 'Hello, I would like to ask about vehicle exports or auto parts.',
    page: 'Enquiry page',
  },
  ru: {
    title: 'Оставить заявку',
    intro: 'Расскажите HD Auto Export, что вы ищете.',
    name: 'Ваше имя', phone: 'Номер телефона', message: 'Комментарий или модель автомобиля',
    method: 'Как с вами связаться?', username: 'Имя пользователя Telegram',
    submit: 'Открыть сообщение', close: 'Закрыть заявку',
    note: 'Имя, телефон и запрос будут добавлены в выбранный чат. Проверьте и отправьте сообщение.',
    draft: 'Здравствуйте! Хочу узнать об экспорте автомобилей или покупке запчастей.',
    page: 'Страница запроса',
  },
} satisfies Record<Locale, Record<string, string>>;
