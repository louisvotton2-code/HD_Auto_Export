import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { routing, type Locale } from '@/i18n/routing';
import { getConfiguredPixelId } from '@/modules/analytics/server';
import { PrivacyAnalyticsWithdrawal } from '@/modules/analytics/consent-controls';
import consentStyles from '@/modules/analytics/consent-controls.module.css';
import { sessionAnalyticsEnabledForSite } from '@/shared/config/session-analytics';
import { siteConfig } from '@/shared/config/site';
import { localizedPageUrl } from '@/shared/lib/page-seo';
import styles from './privacy.module.css';

const sectionIds = ['collection', 'uses', 'cookies', 'data-flows', 'storage', 'rights', 'contacts'] as const;
type PrivacyCopy = {
  title: string;
  summary: string;
  metaPolicyLabel: string;
  sections: Record<(typeof sectionIds)[number], { title: string; description: readonly string[] }>;
};

const privacy = {
  zh: {
    title: '隐私说明',
    summary: '了解 HD Auto Export 如何处理网站访问、车辆咨询、会话分析和广告成效衡量相关的信息。',
    metaPolicyLabel: 'Meta 隐私政策',
    sections: {
      collection: {
        title: '我们收集哪些信息',
        description: [
          '你向我们发送车辆咨询时，我们会收到你提供的联系方式和消息。网站启用访问汇总时，网关使用可信来源 IP，在页面和语言之间按滚动 60 分钟窗口去重。首次访问计入当时所在小时，窗口内的重复访问不延长窗口。多人共用同一网络出口时可能只计为一次访问。',
          '启用联系计数时，主动点击公开车辆的 WhatsApp 或 Telegram 链接会提交公开车辆标识和所选渠道。在支持会话分析的范围内，只有你明确同意后，浏览和部分操作才会关联到随机会话标识。会话分析还记录设备类型、访问来源类别和已知推广活动类别。',
          '网站启用 Meta Pixel（Facebook 像素）时，仅在本站选定的公开车辆详情页上使用。你允许广告衡量后，浏览器才会在这些详情页发送页面访问（PageView）、车辆详情浏览（ViewContent）或主动点击联系链接（Contact）事件。',
        ],
      },
      uses: {
        title: '我们如何使用这些信息',
        description: [
          '我们用你提供的信息回复车辆、购买或运输咨询。访问汇总及联系点击有助于了解网站使用情况和车辆关注度。会话分析用于了解从浏览、筛选到咨询的过程。联系点击只表示你点击了联系入口，实际咨询以你发送的消息为准。',
          '我们用 Meta Pixel 衡量哪些广告带来了看车和联系点击，并优化后续广告投放。',
        ],
      },
      cookies: {
        title: 'Cookie 与浏览器存储',
        description: [
          '浏览器会记住你的隐私选择。「接受」允许横条中说明的用途。同时提供站内分析和广告衡量时，点「选择用途」可只允许其中一项。启用广告衡量后，Meta Pixel 可能设置或读取浏览器 Cookie，以便将看车和联系点击关联到广告。会话分析使用浏览器会话存储保存短期随机标识。网关按 IP 汇总访问独立于 Cookie 和这一选择。',
        ],
      },
      'data-flows': {
        title: '数据流向与服务商',
        description: [
          '访问请求经本站网关送达网站服务。启用会话分析时，网关可能用可信来源 IP 在本机推断国家。车辆联系计数单独发送公开车辆标识和渠道，联系汇总中不保存会话标识、IP 或聊天内容。',
          '当你主动打开 WhatsApp 或 Telegram 链接时，浏览器会进入对应服务。车辆链接可能带上公开车辆资料，方便你编辑询价消息。只有你发送消息后，我们才会通过所选渠道收到你的咨询。服务商对其收到的信息按各自的隐私规则处理。',
          '浏览器会从 Meta 加载 Facebook Pixel，并将事件发送给 Meta。车辆浏览事件包含公开车辆编号，联系点击还包含所选渠道（WhatsApp 或 Telegram）。Meta 也可能收到像素编号、页面及来源网址、广告点击或浏览器 Cookie 标识、IP 地址及浏览器信息，并按其隐私政策处理。',
        ],
      },
      storage: {
        title: '存储与保留',
        description: [
          '系统根据 IP 地址生成短期访问去重键，覆盖 60 分钟去重窗口和短暂的传输缓冲，到期清理。网站访问及联系计数按北京时间汇总，统计汇总和会话摘要保留 90 个北京时间自然日。会话事件明细和会话关联键按 7 天期限清理。会话在连续 30 分钟没有新操作后结束。浏览器中的偏好可通过清除本站数据移除。',
        ],
      },
      rights: {
        title: '你的权利与选择',
        description: [
          '你可以联系我们了解曾提供的信息，或提出查阅、更正、删除请求。你可以在这里一并撤回对会话分析和广告成效衡量的同意。未同意或撤回后仍然可以浏览、查车、计算费用和联系。',
        ],
      },
      contacts: {
        title: '联系方式',
        description: ['如对隐私有疑问，欢迎通过以下渠道联系 HD Auto Export。'],
      },
    },
  },
  en: {
    title: 'Privacy notice',
    summary: 'How HD Auto Export handles information about site visits, vehicle enquiries, session analytics and ad measurement.',
    metaPolicyLabel: 'Meta Privacy Policy',
    sections: {
      collection: {
        title: 'What we collect',
        description: [
          'When you send us a vehicle enquiry, we receive the contact details and message you provide. When visit counting is active, our gateway uses the IP address reported by trusted network infrastructure to count visits across all pages and languages once per address in a rolling window of 60 minutes. The first visit counts in the hour it occurs. Repeat visits within the window do not extend it. People sharing an internet connection may count as one visit.',
          'Where contact counting is active, clicking a public vehicle’s WhatsApp or Telegram link submits the public vehicle identifier and selected channel. Browsing and some actions are associated with a random session identifier only after you explicitly accept session analytics where it is supported. Session analytics also records device type, referral category and recognized campaign category.',
          'When Meta Pixel (Facebook Pixel) is enabled, the site uses it only on selected public vehicle detail pages. After you allow ad measurement, your browser can send a page visit (PageView), a vehicle detail view (ViewContent), or a click you make on a contact link (Contact) on one of those pages.',
        ],
      },
      uses: {
        title: 'How we use the information',
        description: [
          'We use the information you provide to respond to enquiries about vehicles, purchases and delivery. Visit totals and contact clicks help us understand site usage and interest in vehicles. Session analytics helps us understand how people browse, filter and contact us. A contact click records your selection of a contact link. We receive an enquiry when you send a message.',
          'We use Meta Pixel to measure which ads lead to vehicle views and contact clicks and to improve future ad campaigns.',
        ],
      },
      cookies: {
        title: 'Cookies and browser storage',
        description: [
          'Your browser remembers your privacy choices. Accept allows the uses described in the banner. When both site analytics and ad measurement are offered, select Choose purposes to allow just one. When you allow ad measurement, Meta Pixel may set or read browser cookies to associate vehicle views and contact clicks with ads. Session analytics uses browser session storage for a short-lived random identifier. Gateway visit totals based on IP addresses are independent of cookies and this choice.',
        ],
      },
      'data-flows': {
        title: 'Data flows and service providers',
        description: [
          'Visit requests pass through our gateway to the site. Where session analytics is enabled, the gateway may use the IP address reported by trusted infrastructure to infer your country locally. The separate vehicle contact counter receives the public vehicle identifier and channel. Its aggregates contain no session identifiers, IP addresses or chat content.',
          'When you open a WhatsApp or Telegram link, your browser goes to that service. A vehicle link can include public listing details for a draft you can review and edit. We receive your enquiry through the channel you choose once you send it. Each provider handles the information it receives under its own privacy terms.',
          'Your browser loads Facebook Pixel from Meta and sends events to Meta. A vehicle view includes the public vehicle ID. A contact click also includes the channel you chose (WhatsApp or Telegram). Meta may also receive the pixel ID, page and referrer URLs, ad click or browser cookie identifiers, your IP address and browser information. Meta processes this information under its privacy policy.',
        ],
      },
      storage: {
        title: 'Storage and retention',
        description: [
          'The system derives a temporary key from the IP address to deduplicate visits. The key expires after the 60-minute window and a short allowance for delivery delays. Visit and contact counts are aggregated in Beijing time. Reporting aggregates and session summaries are kept for 90 Beijing calendar days. Session event details and session linkage keys are scheduled for removal after 7 days. A session ends after 30 minutes without a new tracked action. You can remove locally stored choices by clearing this site’s data in your browser.',
        ],
      },
      rights: {
        title: 'Your rights and choices',
        description: [
          'You can contact us to ask about information you provided, or to request access, correction or deletion. You can withdraw consent for both session analytics and ad measurement here. Browsing, vehicle search, calculations and contacting us stay available if you leave the banner unanswered or withdraw consent.',
        ],
      },
      contacts: {
        title: 'Contact us',
        description: ['For privacy questions, contact HD Auto Export through either channel below.'],
      },
    },
  },
  ru: {
    title: 'Конфиденциальность',
    summary: 'Как HD Auto Export обрабатывает сведения о посещениях сайта, запросах по автомобилям, аналитике сессий и оценке рекламы.',
    metaPolicyLabel: 'Политика конфиденциальности Meta',
    sections: {
      collection: {
        title: 'Какие данные мы собираем',
        description: [
          'Когда вы отправляете нам запрос по автомобилю, мы получаем указанные вами контактные данные и сообщение. Если включён подсчёт посещений, шлюз использует IP-адрес из доверенного источника, чтобы учитывать посещения разных страниц и языковых версий один раз за скользящий период в 60 минут. Первое посещение относится к тому часу, в котором оно произошло. Повторные посещения не продлевают этот период. Несколько человек с общим сетевым адресом могут быть учтены как одно посещение.',
          'Если включён подсчёт нажатий на контактные ссылки, то при нажатии на ссылку WhatsApp или Telegram в объявлении передаются публичный идентификатор автомобиля и выбранный канал. Просмотры и некоторые действия связываются со случайным идентификатором сессии только после вашего явного согласия, если аналитика сессий доступна. Аналитика сессий также учитывает тип устройства, категорию источника перехода и категорию известной рекламной кампании.',
          'Если на сайте включён Meta Pixel (пиксель Facebook), мы используем его только на выбранных нами общедоступных страницах автомобилей. С вашего согласия на оценку рекламы браузер может отправлять события о посещении такой страницы (PageView), просмотре информации об автомобиле (ViewContent) и нажатии на контактную ссылку на этой странице (Contact).',
        ],
      },
      uses: {
        title: 'Как мы используем данные',
        description: [
          'Мы используем предоставленные вами сведения, чтобы отвечать на вопросы об автомобилях, покупке и доставке. Сводные данные о посещениях и нажатиях помогают понять, как пользуются сайтом и какими автомобилями интересуются. Аналитика сессий показывает, как посетители просматривают каталог, используют фильтры и открывают контактные ссылки. Мы получаем запрос после отправки сообщения.',
          'С помощью Meta Pixel мы определяем, какие объявления приводят к просмотрам автомобилей и нажатиям на кнопки связи, и улучшаем рекламные кампании.',
        ],
      },
      cookies: {
        title: 'Cookie и хранилище браузера',
        description: [
          'Браузер запоминает ваш выбор. Кнопка «Принять» разрешает использование данных в целях, указанных в уведомлении. Если предлагаются и аналитика сайта, и оценка рекламы, кнопка «Выбрать цели» позволяет выбрать только одну из них. С вашего согласия Meta Pixel может сохранять или считывать файлы cookie, чтобы связывать просмотры автомобилей и нажатия на кнопки связи с рекламой. Для аналитики сайт временно сохраняет случайный идентификатор сессии в браузере. Подсчёт посещений на шлюзе по IP-адресу не зависит от cookie и этого выбора.',
        ],
      },
      'data-flows': {
        title: 'Передача данных и поставщики услуг',
        description: [
          'Запросы поступают на сайт через наш шлюз. Если аналитика сессий включена, шлюз может определять страну по IP-адресу из доверенного источника без обращения к внешним сервисам. Отдельный счётчик нажатий на контактные ссылки получает публичный идентификатор автомобиля и канал. В его сводках нет идентификаторов сессий, IP-адресов и содержимого переписки.',
          'Если вы открываете ссылку на WhatsApp или Telegram, браузер переходит в выбранный сервис. Ссылка на контакт по автомобилю может содержать публичные данные объявления для черновика сообщения, который вы можете проверить и изменить. Мы получаем ваш запрос после отправки сообщения. Каждый сервис обрабатывает полученные данные по своим правилам конфиденциальности.',
          'Браузер загружает Facebook Pixel с серверов Meta и передаёт события в Meta. При просмотре передаётся публичный идентификатор автомобиля, а при нажатии на кнопку связи — также выбранный канал (WhatsApp или Telegram). Meta также может получать идентификатор пикселя, адреса текущей и предыдущей страниц, идентификаторы рекламных переходов или файлов cookie, IP-адрес и сведения о браузере. Meta обрабатывает эти данные в соответствии со своей политикой конфиденциальности.',
        ],
      },
      storage: {
        title: 'Хранение данных',
        description: [
          'Система формирует временный ключ из IP-адреса, чтобы учитывать повторные посещения один раз. Срок действия ключа включает 60-минутный период и короткий запас на доставку данных. Посещения и нажатия на контактные ссылки суммируются по пекинскому времени. Сводная статистика и краткие сведения о сессиях хранятся 90 календарных дней по пекинскому времени. Сведения об отдельных событиях сессии и ключи связи с сессией подлежат удалению через 7 дней. Сессия заканчивается через 30 минут без новых учитываемых действий. Чтобы удалить сохранённый в браузере выбор, очистите данные этого сайта.',
        ],
      },
      rights: {
        title: 'Ваши права и выбор',
        description: [
          'Вы можете обратиться к нам за информацией о предоставленных вами данных и запросить их просмотр, исправление или удаление. Здесь можно отозвать согласие сразу на аналитику сессий и на оценку эффективности рекламы. Просмотр сайта, поиск, расчёты и связь с нами доступны независимо от вашего выбора.',
        ],
      },
      contacts: {
        title: 'Контакты',
        description: ['По вопросам конфиденциальности свяжитесь с HD Auto Export через любой из указанных каналов.'],
      },
    },
  },
} satisfies Record<Locale, PrivacyCopy>;

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const { title, summary } = privacy[locale];
  return {
    title,
    description: summary,
    robots: { index: false, follow: false },
    alternates: { canonical: localizedPageUrl(locale, '/privacy/') },
  };
}

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const copy = privacy[locale];
  const { telegram, whatsapp } = siteConfig.contacts;
  const sessionAnalyticsEnabled = sessionAnalyticsEnabledForSite(siteConfig.origin, process.env.ANALYTICS_V2_ENABLED);
  const metaEnabled = Boolean(getConfiguredPixelId());

  return (
    <main id="main" className={consentStyles.privacyPage} data-testid="privacy-page">
      <h1>{copy.title}</h1>
      <p>{copy.summary}</p>
      <div className={styles.panel}>
        {sectionIds.map((id, index) => {
          const { title, description } = copy.sections[id];
          const headingId = `privacy-${id}`;
          return (
            <section key={id} aria-labelledby={headingId} className={styles.section}>
              <h2 id={headingId}>{index + 1}. {title}</h2>
              {description.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {id === 'data-flows' && (
                <div className={styles.contactLinks}>
                  <a href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noopener noreferrer">{copy.metaPolicyLabel}</a>
                </div>
              )}
              {id === 'rights' && (
                <PrivacyAnalyticsWithdrawal
                  locale={locale}
                  sessionAnalyticsEnabled={sessionAnalyticsEnabled}
                  metaEnabled={metaEnabled}
                />
              )}
              {id === 'contacts' && (
                <ul className={styles.contactLinks}>
                  <li><a href={telegram.href} target="_blank" rel="noopener noreferrer">Telegram {telegram.display}</a></li>
                  <li><a href={whatsapp.href} target="_blank" rel="noopener noreferrer">WhatsApp {whatsapp.display}</a></li>
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
