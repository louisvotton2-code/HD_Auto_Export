import type { CalculationInput, CountryCode } from '../core/types';

const eaeu = { name: 'EAEU 107', url: 'https://docs.eaeunion.org/documents/317/8824/' };
const eaeuManufacture = { name: 'EAEU 74', url: 'https://docs.eaeunion.org/documents/315/3038/' };
const officialSources = {
  RU: [
    eaeu,
    eaeuManufacture,
    { name: '№ 1638', url: 'https://publication.pravo.gov.ru/document/0001202510250001' },
    { name: '№ 1713', url: 'https://publication.pravo.gov.ru/document/0001202511010019' },
  ],
  KZ: [
    { name: 'KGD', url: 'https://www.gov.kz/org/kgd/press/news/details/1094558?lang=ru' },
    { name: '№ 448', url: 'https://adilet.zan.kz/rus/docs/V2100025100' },
  ],
  KG: [
    eaeu,
    eaeuManufacture,
    { name: 'EAEU 87', url: 'https://eec.eaeunion.org/comission/department/catr/ett/ru.2022/ru.87_2022_22.01.2026.pdf' },
    { name: '§254 / §310', url: 'https://cbd.minjust.gov.kg/112340/edition/latest/ru' },
    { name: '№ 406', url: 'https://cbd.minjust.gov.kg/7-44821/edition/37748/ru' },
  ],
  AM: [
    eaeu,
    eaeuManufacture,
    { name: 'SRC', url: 'https://exim.src.am/ru/transport' },
    { name: '§171', url: 'https://www.arlis.am/hy/acts/215611/latest' },
    { name: 'HO-487-N', url: 'https://www.arlis.am/hy/acts/487/latest' },
  ],
  UZ: [
    { name: 'PP-3818', url: 'https://lex.uz/ru/docs/3802366' },
    { name: 'Tax Code', url: 'https://lex.uz/ru/docs/4674893' },
    { name: 'PF-115', url: 'https://www.lex.uz/Pages/GetPdf.aspx?file=LexUz_8367811.pdf' },
    { name: '№ 55', url: 'https://lex.uz/ru/docs/7357270' },
    { name: '№ 347', url: 'https://lex.uz/uz/docs/4848953' },
    { name: '№ 52', url: 'https://lex.uz/en/acts/-7361559' },
    { name: '2303-7', url: 'https://www.lex.uz/uz/docs/-7271583' },
  ],
  GE: [
    { name: '№ 1477', url: 'https://matsne.gov.ge/ka/document/view/6826443' },
    { name: '§188 / §197', url: 'https://matsne.gov.ge/ka/document/download/1043717/248/ge/pdf' },
    { name: 'RS', url: 'https://www.rs.ge/CarClearance?tab=1' },
  ],
  AL: [
    { name: 'Dogana', url: 'https://www.dogana.gov.al/english/c/179/customs-clearance-of-vehicles' },
    { name: '№ 26', url: 'https://www.dogana.gov.al/dokument/6706/udhezimi-nr26-date-17122025' },
    { name: 'DPSHTRR', url: 'https://www.dpshtrr.al/mjete/regjistrimi-i-mjetit/mjet-i-perdorur' },
    { name: 'TVML', url: 'https://www.dpshtrr.al/mjete/taksa-dhe-detyrime/taksa-vjetore-e-mjeteve-te-luksit-tvml' },
  ],
  TJ: [
    { name: '№ 470', url: 'https://new.edavlat.tj/api/files_storage/3467' },
    { name: '№ 335', url: 'https://new.edavlat.tj/api/files_storage/3483' },
    { name: '§250', url: 'https://ncz.tj/node/1605' },
    { name: '№ 205', url: 'https://mmih.tj/SEARCH/DocumentView?DocumentId=148078' },
    { name: '№ 476', url: 'https://www.andoz.tj/docs/postanovleniya-pravitelstvo/Qaror_476_2025_tj.pdf' },
  ],
  TM: [
    { name: '61', url: 'https://www.customs.gov.tm/index.php/tk/customs-info/customs-fees/duties' },
    { name: 'Excise', url: 'https://customs.gov.tm/ru/customs-info/customs-fees/excices' },
    { name: '0.2%', url: 'https://www.customs.gov.tm/ru/customs-info/customs-fees/fees' },
    { name: '638/197/275', url: 'https://www.customs.gov.tm/index.php/tk/customs-info/customs-control/68' },
  ],
} satisfies Record<CountryCode, { name: string; url: string }[]>;

export function getCountryOfficialSources(country: CountryCode) {
  return officialSources[country];
}

export function getCountryReferenceNotes(input: CalculationInput): string[] {
  return [`${input.country}.scope`, `${input.country}.manual`];
}
