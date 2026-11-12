'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Locale } from '@/i18n/routing';
import { usePathname } from '@/i18n/navigation';
import { siteConfig } from '@/shared/config/site';
import { SocialIcon } from '@/shared/ui/social-icon';
import { Icon } from '@/shared/ui/icon';
import { enquiryContent } from '../content';
import { enquiryDelayMs, enquirySeenKey, enquirySeenRecently } from '../prompt-policy';
import styles from './enquiry-dialog.module.css';

const EnquiryContext = createContext<{ locale: Locale; open: () => void } | null>(null);

function EnquiryForm({ locale }: { locale: Locale }) {
  const t = enquiryContent[locale];
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');
  const [method, setMethod] = useState<'whatsapp' | 'telegram'>('whatsapp');
  const pathname = usePathname();
  const text = [
    t.draft,
    `${t.name}: ${name.trim()}`,
    `${t.phone}: ${phone.trim()}`,
    ...(message.trim() ? [`${t.message}: ${message.trim()}`] : []),
    ...(method === 'telegram' && username.trim() ? [`${t.username}: ${username.trim()}`] : []),
    `${t.page}: ${siteConfig.origin}/${locale}${pathname}`,
  ].join('\n');

  return (
    <form action={siteConfig.contacts[method].href} method="get" target="_blank" rel="noopener noreferrer" className={styles.form}>
      <input type="hidden" name="text" value={text} />
      <label>
        {t.name}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoFocus
          autoComplete="name"
          maxLength={100}
          required
          pattern=".*\S.*"
        />
      </label>
      <label>
        {t.phone}
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          type="tel"
          autoComplete="tel"
          maxLength={32}
          required
          pattern={String.raw`\+?[0-9][0-9 \(\)\-]{5,31}`}
          placeholder="+86"
        />
      </label>
      <label>
        {t.message}
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={1000} rows={2} />
      </label>
      <fieldset>
        <legend>{t.method}</legend>
        <div className={styles.methods}>
          {(['whatsapp', 'telegram'] as const).map((platform) => (
            <label key={platform} data-platform={platform}>
              <input type="radio" name="channel" value={platform} checked={method === platform} onChange={() => setMethod(platform)} />
              <SocialIcon platform={platform} size={20} />
              {platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
            </label>
          ))}
        </div>
      </fieldset>
      {method === 'telegram' && (
        <label>
          {t.username}
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" maxLength={40} placeholder="@username" />
        </label>
      )}
      <button type="submit" className={styles.submit}>
        <SocialIcon platform={method} size={18} />{t.submit}<Icon name="arrow" size={17} />
      </button>
      <p className={styles.note}>{t.note}</p>
    </form>
  );
}

export function EnquiryTrigger() {
  const context = useContext(EnquiryContext);
  if (!context) return null;
  const title = enquiryContent[context.locale].title;
  return (
    <a href="#contact" className={styles.trigger} aria-haspopup="dialog" aria-label={title} title={title} onClick={(event) => { event.preventDefault(); context.open(); }}>
      <Icon name="document" size={18} /><span>{title}</span>
    </a>
  );
}

export function EnquiryProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const previousOverflow = useRef<string | null>(null);
  const shownThisSession = useRef(false);
  const t = enquiryContent[locale];

  const close = useCallback(() => {
    if (previousOverflow.current !== null) {
      document.body.style.overflow = previousOverflow.current;
      previousOverflow.current = null;
    }
    dialog.current?.close();
    const previous = opener.current;
    opener.current = null;
    previous?.focus({ preventScroll: true });
  }, []);

  const open = useCallback(() => {
    if (!dialog.current || dialog.current.open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current.showModal();
    shownThisSession.current = true;
    try { localStorage.setItem(enquirySeenKey, String(Date.now())); } catch { /* Session frequency control remains active when storage is unavailable. */ }
  }, []);

  useEffect(() => {
    close();
    // Keep vehicle and part consultations uninterrupted. The header trigger remains available.
    if (/^\/(cars|parts)\/[^/]+\/?$/.test(pathname)) return;
    let timer: ReturnType<typeof setTimeout>;
    function prompt() {
      if (shownThisSession.current) return;
      try { if (enquirySeenRecently(localStorage.getItem(enquirySeenKey), Date.now())) return; } catch { /* Fall back to this mounted session. */ }
      const editing = document.activeElement?.matches('input, textarea, select, [contenteditable="true"]');
      if (document.hidden || editing || document.querySelector('dialog[open], header details[open]') || document.body.style.overflow === 'hidden') {
        timer = setTimeout(prompt, 5000);
        return;
      }
      open();
    }
    timer = setTimeout(prompt, enquiryDelayMs);
    return () => { clearTimeout(timer); close(); };
  }, [pathname, close, open]);

  return (
    <EnquiryContext.Provider value={{ locale, open }}>
      {children}
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby="site-enquiry-title"
        aria-describedby="site-enquiry-intro"
        onCancel={(event) => { event.preventDefault(); close(); }}
        onClose={close}
        onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      >
        <div className={styles.card}>
          <button className={styles.close} type="button" aria-label={t.close} onClick={close}>×</button>
          <span className={styles.brand}>{siteConfig.name}</span>
          <h2 id="site-enquiry-title">{t.title}</h2>
          <p id="site-enquiry-intro" className={styles.intro}>{t.intro}</p>
          <EnquiryForm locale={locale} />
          <div className={styles.social}>
            {(['whatsapp', 'telegram', 'instagram'] as const).map((platform) => (
              <a key={platform} href={siteConfig.contacts[platform].href} target="_blank" rel="noopener noreferrer" aria-label={platform}><SocialIcon platform={platform} size={22} /></a>
            ))}
          </div>
        </div>
      </dialog>
    </EnquiryContext.Provider>
  );
}
