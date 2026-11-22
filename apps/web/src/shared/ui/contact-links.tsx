'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { siteConfig } from '@/shared/config/site';
import { Icon } from './icon';
import { SocialIcon } from './social-icon';

const directContacts = ['telegram', 'whatsapp'] as const;
const socialContacts = ['facebook', 'instagram', 'tiktok'] as const;

export function ContactLinks() {
  const t = useTranslations('Contacts');
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (!copied && !copyFailed) return;
    const timeout = window.setTimeout(() => {
      setCopied(null);
      setCopyFailed(false);
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [copied, copyFailed]);

  async function copy(copyValue: string) {
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(copyValue);
      setCopyFailed(false);
    } catch {
      setCopied(null);
      setCopyFailed(true);
    }
  }

  function contactLink(key: (typeof directContacts | typeof socialContacts)[number]) {
    return (
      <a
        key={key}
        className="hd-contact-item"
        href={siteConfig.contacts[key].href}
        target="_blank"
        rel="noopener noreferrer"
        data-analytics-contact={key === 'whatsapp' || key === 'telegram' ? key : undefined}
      >
        <span className="hd-contact-icon" data-channel={key} aria-hidden="true">
          <SocialIcon platform={key} size={18} />
        </span>
        <span className="hd-contact-label">
          <strong>{t(key)}</strong>
          <span dir="ltr">{siteConfig.contacts[key].display}</span>
        </span>
      </a>
    );
  }

  return (
    <>
      <div className="hd-contact-grid">
        {directContacts.map(contactLink)}
        {siteConfig.contacts.wechat.map(({ display, copyValue }) => (
          <button
            type="button"
            key={copyValue}
            className="hd-contact-item"
            onClick={() => copy(copyValue)}
            aria-label={`${t('copyAccount', { platform: t('wechat') })} ${display}`}
          >
            <span className="hd-contact-icon" data-channel="wechat" aria-hidden="true">
              <SocialIcon platform="wechat" size={18} />
            </span>
            <span className="hd-contact-label">
              <strong>{t('wechat')}</strong>
              <span dir="ltr">{display}</span>
            </span>
            <span className="hd-copy-action">
              <Icon name={copied === copyValue ? 'check' : 'copy'} size={14} />
              <small>{t(copied === copyValue ? 'copied' : 'copy')}</small>
            </span>
          </button>
        ))}
      </div>
      <h3>{t('follow')}</h3>
      <div className="hd-contact-grid">
        {socialContacts.map(contactLink)}
      </div>
      <span className="hd-contact-status" role="status" aria-live="polite">
        {copyFailed ? t('copyFailed') : copied ? t('copied') : ''}
      </span>
    </>
  );
}
