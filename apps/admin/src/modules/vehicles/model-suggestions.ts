import { findBrand, normalizeBrandAlias } from '@hd/contracts/admin';

// Suggestions are model names only. Vehicle facts still come from the person entering the draft.
const modelsByBrand: Record<string, readonly (readonly [id: string, name: string, alternate?: string])[]> = {
  toyota: [['corolla', '卡罗拉', 'Corolla'], ['camry', '凯美瑞', 'Camry'], ['rav4', 'RAV4荣放', 'RAV4'], ['highlander', '汉兰达', 'Highlander'], ['prado', '普拉多', 'Prado'], ['land-cruiser', '兰德酷路泽', 'Land Cruiser']],
  honda: [['civic', '思域', 'Civic'], ['accord', '雅阁', 'Accord'], ['cr-v', 'CR-V'], ['fit', '飞度', 'Fit']],
  nissan: [['sylphy', '轩逸', 'Sylphy'], ['teana', '天籁', 'Teana'], ['x-trail', '奇骏', 'X-Trail']],
  volkswagen: [['lavida', '朗逸', 'Lavida'], ['sagitar', '速腾', 'Sagitar'], ['passat', '帕萨特', 'Passat'], ['tiguan-l', '途观L', 'Tiguan L']],
  tesla: [['model-3', 'Model 3'], ['model-y', 'Model Y']],
  byd: [['qin-plus', '秦PLUS'], ['song-plus', '宋PLUS'], ['han', '汉'], ['tang', '唐'], ['seal', '海豹', 'Seal'], ['dolphin', '海豚', 'Dolphin'], ['yuan-plus', '元PLUS', 'Atto 3'], ['seagull', '海鸥', 'Seagull']],
  geely: [['monjaro', '星越L', 'Monjaro'], ['preface', '星瑞', 'Preface'], ['coolray', '缤越', 'Coolray'], ['emgrand', '帝豪', 'Emgrand']],
  chery: [['tiggo-7', '瑞虎7', 'Tiggo 7'], ['tiggo-8', '瑞虎8', 'Tiggo 8'], ['tiggo-9', '瑞虎9', 'Tiggo 9']],
  changan: [['cs55-plus', 'CS55 PLUS'], ['cs75-plus', 'CS75 PLUS'], ['uni-k', 'UNI-K'], ['uni-v', 'UNI-V']],
  haval: [['h6', '哈弗H6', 'Haval H6'], ['jolion', '初恋', 'Jolion'], ['dargo', '大狗', 'Dargo']],
  tank: [['300', '坦克300', 'Tank 300'], ['400', '坦克400', 'Tank 400'], ['500', '坦克500', 'Tank 500']],
  zeekr: [['001', '极氪001', 'Zeekr 001'], ['007', '极氪007', 'Zeekr 007'], ['009', '极氪009', 'Zeekr 009'], ['x', '极氪X', 'Zeekr X']],
  'li-auto': [['l6', '理想L6', 'Li L6'], ['l7', '理想L7', 'Li L7'], ['l8', '理想L8', 'Li L8'], ['l9', '理想L9', 'Li L9']],
  xpeng: [['g6', '小鹏G6', 'XPeng G6'], ['g9', '小鹏G9', 'XPeng G9'], ['p7', '小鹏P7', 'XPeng P7']],
};

type NamedValue = { id: string; name: string };

export function modelIdentityOptions(make: NamedValue, choices: NamedValue[], selected: NamedValue) {
  const existing = [...choices];
  if (selected.id && !existing.some(item => item.id === selected.id)) existing.push(selected);
  const options = existing.map(item => ({ value: item.id, label: item.name, rawName: item.name }));
  const brand = findBrand(make);
  if (!brand) return options;

  for (const [id, name, alternate] of modelsByBrand[brand.catalogId] ?? []) {
    const value = `${brand.catalogId}-${id}`;
    const aliases = [name, alternate ?? name].map(normalizeBrandAlias);
    if (!existing.some(item => item.id === value || aliases.includes(normalizeBrandAlias(item.name)))) {
      options.push({ value, label: alternate ? `${name} / ${alternate}` : name, rawName: name });
    }
  }
  return options;
}
