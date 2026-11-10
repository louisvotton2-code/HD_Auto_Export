'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { siteConfig } from '@/shared/config/site';
import { Icon } from './icon';
import { SocialIcon } from './social-icon';

const phones = ['phone', 'phone2'] as const;
const socialContacts = ['telegram', 'whatsapp', 'facebook', 'instagram', 'tiktok'] as const;
const copyContacts = ['wechat'] as const;
type CopyContact = (typeof copyContacts)[number];

export function ContactLinks() {
  const t = useTranslations('Contacts');
  const [copied, setCopied] = useState<CopyContact | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (!copied && !copyFailed) return;
    const timeout = window.setTimeout(() => {
      setCopied(null);
      setCopyFailed(false);
    }, 3000);
    return () => window.clearTimeout(timeout);
  }, [copied, copyFailed]);

  async function copy(key: CopyContact) {
    try {
      await navigator.clipboard.writeText(siteConfig.contacts[key].copyValue);
      setCopied(key);
      setCopyFailed(false);
    } catch {
      setCopied(null);
      setCopyFailed(true);
    }
  }

  return (
    <>
      <div className="hd-contact-grid">
        {phones.map((key) => (
          <a
            key={key}
            className="hd-contact-item"
            href={siteConfig.contacts[key].href}
          >
            <span className="hd-contact-icon" aria-hidden="true">
              <Icon name="phone" size={17} />
            </span>
            <span className="hd-contact-label">
              <strong>{t('phone')}</strong>
              <span dir="ltr">{siteConfig.contacts[key].display}</span>
            </span>
          </a>
        ))}
        {copyContacts.map((key) => (
          <button
            type="button"
            key={key}
            className="hd-contact-item"
            onClick={() => copy(key)}
            aria-label={t('copyAccount', { platform: t(key) })}
          >
            <span className="hd-contact-icon" data-channel={key} aria-hidden="true">
              <SocialIcon platform={key} size={18} />
            </span>
            <span className="hd-contact-label">
              <strong>{t(key)}</strong>
              <span dir="ltr">{siteConfig.contacts[key].display}</span>
            </span>
            <span className="hd-copy-action">
              <Icon name={copied === key ? 'check' : 'copy'} size={14} />
              <small>{t(copied === key ? 'copied' : 'copy')}</small>
            </span>
          </button>
        ))}
      </div>
      <h3>{t('follow')}</h3>
      <div className="hd-contact-grid">
        {socialContacts.map((key) => (
          <a
            key={key}
            className="hd-contact-item"
            href={siteConfig.contacts[key].href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="hd-contact-icon" data-channel={key} aria-hidden="true">
              <SocialIcon platform={key} size={18} />
            </span>
            <span className="hd-contact-label">
              <strong>{t(key)}</strong>
              <span dir="ltr">{siteConfig.contacts[key].display}</span>
            </span>
          </a>
        ))}
      </div>
      <span className="hd-contact-status" role="status" aria-live="polite">
        {copyFailed ? t('copyFailed') : copied ? t('copied') : ''}
      </span>
    </>
  );
}
