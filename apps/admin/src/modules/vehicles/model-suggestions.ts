import { normalizeBrandAlias } from '@hd/contracts/admin';
import { entryBrands } from './vehicle-entry-brands';
import { modelsByBrand } from './vehicle-entry-models';

type NamedValue = { id: string; name: string };

type IdentityOption = {
  value: string;
  label: string;
  rawName: string;
  aliases: readonly string[];
};

const normalizeIdentityName = (name: string) => normalizeBrandAlias(name).replace(/[\s\-‐‑‒–—―]/g, '');
const brandById = new Map(entryBrands.map(brand => [brand.id, brand]));
const brandByName = new Map(entryBrands.flatMap(brand =>
  [brand.name, brand.latin, brand.id, ...brand.aliases].map(name => [normalizeIdentityName(name), brand] as const)));

function entryBrand(make: NamedValue) {
  return brandById.get(make.id.toLowerCase()) ?? brandByName.get(normalizeIdentityName(make.name));
}

function currentIdentities(choices: NamedValue[], selected: NamedValue) {
  const known = new Map(choices.map(choice => [choice.id, choice]));
  if (selected.id && selected.name) known.set(selected.id, selected);
  return [...known.values()];
}

function brandLabel(brand: (typeof entryBrands)[number]) {
  return brand.name === brand.latin ? brand.name : `${brand.name} / ${brand.latin}`;
}

export function brandIdentityOptions(choices: NamedValue[], selected: NamedValue): IdentityOption[] {
  const existing = currentIdentities(choices, selected);
  const options = existing.map(item => {
    const brand = entryBrand(item);
    return {
      value: item.id, rawName: item.name,
      label: brand ? `${brandLabel(brand)}${item.id !== brand.id ? '（现有记录）' : ''}` : item.name,
      aliases: brand ? [brand.name, brand.latin, ...brand.aliases] : [],
    };
  });
  const existingIds = new Set(existing.map(item => item.id));
  for (const brand of entryBrands) {
    if (existingIds.has(brand.id)) continue;
    options.push({ value: brand.id, label: brandLabel(brand), rawName: brand.name, aliases: [brand.latin, ...brand.aliases] });
  }
  return options;
}

export function modelIdentityOptions(make: NamedValue, choices: NamedValue[], selected: NamedValue): IdentityOption[] {
  const existing = currentIdentities(choices, selected);
  const brandId = entryBrand(make)?.id;
  const modelNames = brandId ? modelsByBrand[brandId] ?? [] : [];
  const suggestions = modelNames.map(([id, name, alternate, ...aliases]) => ({
    value: `${brandId}-${id}`, label: alternate ? `${name} / ${alternate}` : name, rawName: name,
    aliases: alternate ? [alternate, ...aliases] : aliases,
  }));
  const suggestionById = new Map(suggestions.map(model => [model.value, model]));
  const suggestionByName = new Map(suggestions.flatMap(model =>
    [model.rawName, ...model.aliases].map(name => [normalizeIdentityName(name), model] as const)));
  const usedSuggestions = new Set<string>();
  const options = existing.map(item => {
    const match = suggestionById.get(item.id) ?? suggestionByName.get(normalizeIdentityName(item.name));
    if (match) usedSuggestions.add(match.value);
    return {
      value: item.id, label: item.name, rawName: item.name,
      aliases: match ? [match.rawName, ...match.aliases] : [],
    };
  });
  return [...options, ...suggestions.filter(model => !usedSuggestions.has(model.value))];
}

export function matchesIdentitySearch(input: string, option?: IdentityOption): boolean {
  if (!option) return false;
  const query = normalizeIdentityName(input);
  return [option.label, option.rawName, ...option.aliases].some(name => normalizeIdentityName(name).includes(query));
}

export function findIdentityByName(options: IdentityOption[], name: string): IdentityOption | undefined {
  const query = normalizeIdentityName(name);
  if (!query) return undefined;
  return options.find(option => normalizeIdentityName(option.rawName) === query) ??
    options.find(option => option.aliases.some(alias => normalizeIdentityName(alias) === query));
}
