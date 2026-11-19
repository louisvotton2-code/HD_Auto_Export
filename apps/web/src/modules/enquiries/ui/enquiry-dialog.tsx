'use client';

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { Locale } from '@/i18n/routing';
import { usePathname } from '@/i18n/navigation';
import { siteConfig } from '@/shared/config/site';
import { SocialIcon } from '@/shared/ui/social-icon';
import { Icon } from '@/shared/ui/icon';
import { enquiryContent } from '../content';
import { enquiryDelayMs, enquirySeenKey, enquirySeenRecently } from '../prompt-policy';
import styles from './enquiry-dialog.module.css';

const EnquiryContext = createContext<((trigger?: HTMLElement) => void) | null>(null);
const platforms = ['whatsapp', 'telegram', 'instagram', 'facebook', 'tiktok'] as const;

export function EnquiryTrigger() {
  const open = useContext(EnquiryContext);
  const contacts = useTranslations('Contacts');
  if (!open) return null;
  const title = contacts('title');
  return (
    <a
      href="#contact"
      className={styles.trigger}
      aria-haspopup="dialog"
      aria-label={title}
      title={title}
      onClick={(event) => {
        event.preventDefault();
        open(event.currentTarget);
      }}
    >
      <Icon name="chat" size={18} />
      <span>{title}</span>
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
  const contacts = useTranslations('Contacts');

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

  const open = useCallback((trigger?: HTMLElement) => {
    if (!dialog.current || dialog.current.open) return;
    opener.current = trigger ?? (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    );
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
    <EnquiryContext.Provider value={open}>
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
          <button className={styles.close} type="button" aria-label={t.close} onClick={close}><Icon name="close" size={20} /></button>
          <span className={styles.brand}>{siteConfig.name}</span>
          <h2 id="site-enquiry-title">{contacts('title')}</h2>
          <p id="site-enquiry-intro" className={styles.intro}>{t.intro}</p>
          <div className={styles.social}>
            {platforms.map((platform) => (
              <a
                key={platform}
                href={siteConfig.contacts[platform].href}
                target="_blank"
                rel="noopener noreferrer"
                data-platform={platform}
                data-analytics-contact={platform === 'whatsapp' || platform === 'telegram' ? platform : undefined}
                aria-label={contacts(platform)}
                title={contacts(platform)}
              >
                <SocialIcon platform={platform} size={23} />
              </a>
            ))}
          </div>
        </div>
      </dialog>
    </EnquiryContext.Provider>
  );
}
