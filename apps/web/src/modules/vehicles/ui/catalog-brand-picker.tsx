'use client';

import type { Locale } from '@/i18n/routing';
import { SearchableOptionPicker, type SearchableOption } from '@/shared/ui/searchable-option-picker';
import { catalogFilterCopy } from '../catalog-filter-copy';
import { publicVehicleMessages } from '../public-messages';

export function CatalogBrandPicker({
  locale, brands, value, pending, onChange,
}: {
  locale: Locale;
  brands: readonly SearchableOption[];
  value: string;
  pending: boolean;
  onChange: (value: string) => void;
}) {
  const { make: label, all } = publicVehicleMessages(locale);
  const copy = catalogFilterCopy[locale];
  const options = [{ id: '', name: all }, ...brands];
  if (value && !brands.some(brand => brand.id === value)) options.push({ id: value, name: copy.selected });

  return <SearchableOptionPicker locale={locale} name="make" label={label} options={options} value={value}
    pending={pending} onChange={onChange} testId="catalog-brand-search"
    messages={{ search: copy.brandSearch, loading: copy.optionsLoading, empty: copy.noBrands, selected: copy.selected }} />;
}
