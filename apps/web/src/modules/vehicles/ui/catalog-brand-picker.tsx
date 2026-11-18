'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Locale } from '@/i18n/routing';
import { Icon } from '@/shared/ui/icon';
import { catalogFilterCopy } from '../catalog-filter-copy';
import { publicVehicleMessages } from '../public-messages';
import styles from './public-vehicles.module.css';

type BrandOption = { id: string; name: string; count?: number };

export function CatalogBrandPicker({
  locale, brands, value, onChange,
}: {
  locale: Locale;
  brands: BrandOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { make: label, all } = publicVehicleMessages(locale);
  const copy = catalogFilterCopy[locale];
  const inputId = useId();
  const listId = `${inputId}-options`;
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [enhanced, setEnhanced] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const options: BrandOption[] = [{ id: '', name: all }, ...brands];
  if (value && !brands.some(brand => brand.id === value)) options.push({ id: value, name: copy.selected });
  const selected = options.find(option => option.id === value)!.name;
  const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase(locale).replace(/[\s_-]+/g, ' ').trim();
  const term = normalize(search);
  const matches = term ? options.filter(option => option.id && (
    normalize(option.name).includes(term) || normalize(option.id).includes(term)
  )) : options;
  const activeIndex = matches.findIndex(option => option.id === active);

  useEffect(() => setEnhanced(true), []);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);
  useEffect(() => {
    if (open && activeIndex >= 0)
      list.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [open, activeIndex]);

  function close() {
    setOpen(false);
    setSearch('');
    setActive(null);
  }

  function select(id: string) {
    close();
    if (id !== value) onChange(id);
  }

  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && open) {
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
      if (!open) setOpen(true);
      else if (activeIndex >= 0) select(matches[activeIndex]!.id);
      else if (term && matches.length) select(matches[0]!.id);
    }
  }

  const optionLabel = ({ name, count }: BrandOption) => count === undefined ? name : `${name} (${count})`;
  return (
    <>
      {/* Keep a single native GET value, including pre-hydration and disabled JavaScript. */}
      <label hidden={enhanced}>
        <span>{label}</span>
        <select name="make" value={value} onChange={event => select(event.currentTarget.value)}>
          {options.map(option => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
        </select>
      </label>
      {enhanced && (
        <div
          ref={root}
          className={styles.brandPicker}
          onBlur={event => {
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) close();
          }}
        >
          <label htmlFor={inputId}>{label}</label>
          <div className={styles.brandPickerControl}>
            <input
              id={inputId}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={listId}
              aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              aria-describedby={`${inputId}-selection`}
              data-testid="catalog-brand-search"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={120}
              value={search}
              placeholder={open ? copy.brandSearch : selected}
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
            <Icon name="chevron" size={14} />
          </div>
          <span id={`${inputId}-selection`} className={styles.srOnly}>{copy.selected}: {selected}</span>
          <div className={styles.brandPickerMenu} hidden={!open}>
            <ul ref={list} id={listId} role="listbox" aria-label={label}>
              {matches.map((option, index) => (
                <li
                  key={option.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.id === value}
                  data-active={index === activeIndex || undefined}
                  data-make-option={option.id}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => select(option.id)}
                >
                  {optionLabel(option)}
                </li>
              ))}
            </ul>
            {!matches.length && <p role="status">{copy.noBrands}</p>}
          </div>
        </div>
      )}
    </>
  );
}
