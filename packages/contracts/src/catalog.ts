import type { Locale } from './common.js';

/** Curated spelling dictionary, not a complete vehicle catalogue or a source of vehicle facts.
 * Registered Latin brand names are deliberately shared by English and Russian displays.
 * Matching never changes a stored make ID or merges historical manual IDs.
 */
export const BRAND_CATALOG_VERSION = '2026-11-08.1';
export const BRAND_CATALOG = [
  ['toyota','丰田','Toyota'], ['lexus','雷克萨斯','Lexus'], ['honda','本田','Honda'],
  ['nissan','日产','Nissan'], ['mazda','马自达','Mazda'], ['mitsubishi','三菱','Mitsubishi'],
  ['subaru','斯巴鲁','Subaru'], ['suzuki','铃木','Suzuki'], ['bmw','宝马','BMW'],
  ['mercedes-benz','奔驰','Mercedes-Benz'], ['audi','奥迪','Audi'], ['volkswagen','大众','Volkswagen'],
  ['porsche','保时捷','Porsche'], ['volvo','沃尔沃','Volvo'], ['ford','福特','Ford'],
  ['chevrolet','雪佛兰','Chevrolet'], ['tesla','特斯拉','Tesla'], ['hyundai','现代','Hyundai'],
  ['kia','起亚','Kia'], ['byd','比亚迪','BYD'], ['geely','吉利','Geely'], ['chery','奇瑞','Chery'],
  ['changan','长安','Changan'], ['haval','哈弗','HAVAL'], ['tank','坦克','TANK'],
  ['hongqi','红旗','Hongqi'], ['zeekr','极氪','ZEEKR'], ['li-auto','理想','Li Auto'],
  ['xpeng','小鹏','XPENG'], ['nio','蔚来','NIO'], ['voyah','岚图','VOYAH'],
  ['avatr','阿维塔','AVATR'], ['leapmotor','零跑','Leapmotor'], ['wuling','五菱','Wuling'], ['bestune','奔腾','Bestune'],
  ['mhero','猛士','MHero'], ['gac','广汽','GAC'],
] .map(([catalogId,zh,latin])=>({catalogId:catalogId!,labels:{zh:zh!,en:latin!,ru:latin!},aliases:[catalogId!,zh!,latin!]}));
export type BrandCatalogEntry = (typeof BRAND_CATALOG)[number];
export const normalizeBrandAlias=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export function findBrand(value:{id:string;name:string}|null):BrandCatalogEntry|undefined {
  if(!value)return undefined;
  const byId=BRAND_CATALOG.find(brand=>brand.catalogId===value.id.toLowerCase());
  return byId??BRAND_CATALOG.find(brand=>brand.aliases.some(alias=>normalizeBrandAlias(alias)===normalizeBrandAlias(value.name)));
}
export function brandLabel(value:{id:string;name:string}|null,locale:Locale):string|null {
  return findBrand(value)?.labels[locale]??null;
}
