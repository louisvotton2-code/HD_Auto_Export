'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { siteConfig } from '@/shared/config/site';
import { Icon } from './icon';

const linkedContacts = ['whatsapp', 'facebook', 'phone'] as const;
const copyContacts = ['instagram', 'telegram', 'wechat'] as const;
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
        {linkedContacts.map((key) => (
          <a
            key={key}
            className="hd-contact-item"
            href={siteConfig.contacts[key].href}
            {...(key === 'phone' ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
          >
            <span>
              <strong>{t(key)}</strong>
              <span dir="ltr">{siteConfig.contacts[key].display}</span>
            </span>
            <Icon name="diagonal" size={15} />
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
            <span>
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
      <span className="hd-contact-status" role="status" aria-live="polite">
        {copyFailed ? t('copyFailed') : copied ? t('copied') : ''}
      </span>
    </>
  );
}
