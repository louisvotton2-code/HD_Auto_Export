'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Locale } from '@/i18n/routing';
import { Icon } from './icon';
import styles from './searchable-option-picker.module.css';

export type SearchableOption = { id: string; name: string; count?: number };

type PickerMessages = { search: string; loading: string; empty: string; selected: string };

function searchKey(value: string, locale: Locale) {
  return value.normalize('NFKC').toLocaleLowerCase(locale).replace(/[\s\p{Pd}_./\\·・•]+/gu, '');
}

function optionLabel({ name, count }: SearchableOption) {
  return count === undefined ? name : `${name} (${count})`;
}

export function SearchableOptionPicker({
  locale, name, label, options, value, pending, disabled, required, invalid,
  describedBy, testId, messages, onChange,
}: {
  locale: Locale;
  name: string;
  label: string;
  options: readonly SearchableOption[];
  value: string;
  pending?: boolean;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  describedBy?: string;
  testId?: string;
  messages: PickerMessages;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  const listId = `${inputId}-options`;
  const selectionId = `${inputId}-selection`;
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const selected = options.find(option => option.id === value)?.name ?? messages.selected;
  const isOpen = open && !disabled;
  const searchable = useMemo(() => options.map(option => ({
    option, nameKey: searchKey(option.name, locale), idKey: searchKey(option.id, locale),
  })), [locale, options]);
  const term = isOpen ? searchKey(search, locale) : '';
  const matches = term ? searchable.filter(({ option, nameKey, idKey }) => option.id && (
    nameKey.includes(term) || idKey.includes(term)
  )).map(({ option }) => option) : options;
  const activeIndex = matches.findIndex(option => option.id === active);

  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
    setActive(null);
  }, []);

  useEffect(() => setEnhanced(true), []);
  useEffect(() => {
    if (disabled) close();
  }, [close, disabled]);
  useEffect(() => {
    if (!isOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [close, isOpen]);
  useEffect(() => {
    if (isOpen && activeIndex >= 0)
      list.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [activeIndex, isOpen]);

  function select(id: string) {
    close();
    if (id !== value) onChange(id);
  }

  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Tab') {
      close();
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      const next = event.key === 'ArrowDown'
        ? Math.min(activeIndex + 1, matches.length - 1)
        : activeIndex < 0 ? matches.length - 1 : Math.max(activeIndex - 1, 0);
      setActive(matches[next]?.id ?? null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (!isOpen) setOpen(true);
      else if (activeIndex >= 0) select(matches[activeIndex]!.id);
      else if (term && matches.length) select(matches[0]!.id);
    }
  }

  return (
    <>
      {/* Keep the selected ID as a native form value before and after hydration. */}
      <label className={styles.fallback} hidden={enhanced}>
        <span>{label}</span>
        <select name={name} value={value} disabled={disabled} required={!enhanced && required}
          aria-busy={pending || undefined} aria-invalid={invalid || undefined} aria-describedby={describedBy}
          onChange={event => select(event.currentTarget.value)}>
          {options.map(option => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
        </select>
      </label>
      {enhanced && (
        <div ref={root} className={styles.picker}
          onBlur={event => {
            // Touch selection may blur to no related target before its click is delivered.
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
          }}>
          <label htmlFor={inputId}>{label}</label>
          <div className={styles.control}>
            <input
              id={inputId}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={isOpen}
              aria-required={required || undefined}
              aria-invalid={invalid || undefined}
              aria-busy={pending || undefined}
              aria-controls={isOpen ? listId : undefined}
              aria-activedescendant={isOpen && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              aria-describedby={describedBy ? `${selectionId} ${describedBy}` : selectionId}
              data-testid={testId}
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={120}
              disabled={disabled}
              value={search}
              placeholder={isOpen || !value ? messages.search : selected}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onChange={event => {
                setOpen(true);
                setSearch(event.currentTarget.value);
                setActive(null);
                if (list.current) list.current.scrollTop = 0;
              }}
              onKeyDown={keys}
            />
            <Icon name="search" size={16} className={styles.searchIcon} />
            <Icon name="chevron" size={14} className={styles.chevron} />
          </div>
          <span id={selectionId} className="sr-only">{messages.selected}: {selected}</span>
          {isOpen && <div className={styles.menu}>
            <ul ref={list} id={listId} role="listbox" aria-label={label}>
              {matches.map((option, index) => (
                <li
                  key={option.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.id === value}
                  data-active={index === activeIndex || undefined}
                  data-option-id={option.id}
                  {...{ [`data-${name}-option`]: option.id }}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => select(option.id)}
                >
                  {optionLabel(option)}
                </li>
              ))}
            </ul>
            {pending ? <p role="status">{messages.loading}</p> : !matches.length && <p role="status">{messages.empty}</p>}
          </div>}
        </div>
      )}
    </>
  );
}
