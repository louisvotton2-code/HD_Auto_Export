import {createHash} from 'node:crypto';
import {findBrand,LocalizationDataSchema,vehicleConfigurationItemId,type DisplayField,type LocalizationData,type VehicleDraftInput} from '@hd/contracts/admin';
import {PublicPriceSchema,type DisplayText,type Locale,type PublicVehicle,type VehicleDisplay} from '@hd/contracts/public';
import {conflict,ApiError} from '../errors.js';
import {hasTranslationText,isChineseSource,locales} from './content.js';
import { configurationValueNeedsTranslation, projectConfiguration } from './configuration.js';
import { configurationCatalogText, CONFIGURATION_TRANSLATION_CATALOG_VERSION, isConfigurationCatalogEngine } from './configuration-translation-catalog.js';

type Source=Pick<VehicleDraftInput,'source'|'facts'|'price'|'configuration'> & {media?:VehicleDraftInput['media'];images?:PublicVehicle['images']};
export type StoredLocalization={revision:number;data:LocalizationData;bindings:Record<string,string>;retiredFields:DisplayField[]};
export type PublishedLocalization=Pick<StoredLocalization,'data'|'bindings'>;
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function technicalFactsIdentity(facts:VehicleDraftInput['facts']) {
  return digest([facts.make?.id, facts.model?.id, facts.trim?.id, facts.modelYear]);
}
export const emptyLocalization=():StoredLocalization=>({revision:0,data:{facts:{generation:null,drivetrain:null},fields:[]},bindings:{},retiredFields:[]});
const stableId=(input:unknown)=>{const hex=digest(input);return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;};
const fieldHash=(ref:string,binding:string,language:string,text:string)=>digest([ref,binding,language,text]);

/** Derive only explicitly public raw fields. GET computes this without persisting anything. */
export function syncLocalization(id:string,source:Source,previous:StoredLocalization=emptyLocalization(),newLanguage:'zh'|'und'='und'):StoredLocalization {
  id=id.toLowerCase();
  const next=structuredClone(previous);const fields:DisplayField[]=[];const bindings:Record<string,string>={};
  const old=new Map(previous.data.fields.map(field=>[field.ref,field]));
  const add=(ref:string,text:string|null|undefined,identity:unknown)=>{
    if(!text?.trim())return;
    const binding=digest(identity);bindings[ref]=binding;
    const prior=old.get(ref);const language=prior?.sourceLanguage??newLanguage;
    const hash=fieldHash(ref,binding,language,text);
    if(prior) {
      const field=structuredClone(prior);
      const changed = prior.sourceHash !== hash;
      if(changed){field.sourceVersion++;for(const value of Object.values(field.translations))if(value)value.reviewStatus='stale';}
      field.sourceText=text;field.sourceHash=hash;
      const chinese = field.translations.zh;
      const refreshOriginal = changed && chinese?.kind === 'original' && chinese.text === prior.sourceText;
      if (isChineseSource(field.sourceLanguage) && (!hasTranslationText(chinese) || refreshOriginal))
        field.translations.zh={text,kind:'original',reviewStatus:'pending',sourceVersion:field.sourceVersion,humanEditVersion:(prior.translations.zh?.humanEditVersion??0)+1,engineVersion:null};
      fields.push(field);
    } else fields.push({ref,sourceText:text,sourceLanguage:language,sourceVersion:1,sourceHash:hash,translations:{zh:isChineseSource(language)?{text,kind:'original',reviewStatus:'pending',sourceVersion:1,humanEditVersion:0,engineVersion:null}:null,en:null,ru:null}});
  };
  const facts=source.facts;
  if(!findBrand(facts.make))add('make',facts.make?.name,facts.make?.id);
  add('model',facts.model?.name,[facts.make?.id,facts.model?.id]);
  add('trim',facts.trim?.name,[facts.make?.id,facts.model?.id,facts.trim?.id]);
  add('generation',previous.data.facts.generation?.name,[facts.make?.id,facts.model?.id,previous.data.facts.generation?.id]);
  add('location.city',facts.location?.city,facts.location?.country);
  add('location.displayName',facts.location?.displayName,facts.location?.country);
  if(source.source.kind==='external')add('source.platform',source.source.platform.name,source.source.platform.id);
  for(const media of source.media??source.images??[])add(`media.${media.id.toLowerCase()}.alt`,media.alt,media.id.toLowerCase());
  const priorIncludes=previous.data.fields.filter(field=>field.ref.startsWith('price.includes.'));
  const claimed=new Set<string>();const groupHash=digest(source.price.includes);
  // Keep IDs for exact matching items across reorders; the whole group binding invalidates every prior translation.
  const chosen=source.price.includes.map(text=>{const match=priorIncludes.find(field=>!claimed.has(field.ref)&&field.sourceText===text);if(match)claimed.add(match.ref);return match;});
  source.price.includes.forEach((text,index)=>{
    const prior=chosen[index]??priorIncludes.find(field=>!claimed.has(field.ref));if(prior)claimed.add(prior.ref);
    const ref=prior?.ref??`price.includes.${stableId([id,groupHash,index])}`;
    add(ref,text,[groupHash,index]);
  });
  for (const item of source.configuration?.items ?? []) {
    const key = vehicleConfigurationItemId(item.name);
    add(`configuration.${key}.name`, item.name, [key, 'name']);
    if (configurationValueNeedsTranslation(item.value)) add(`configuration.${key}.value`, item.value, [key, 'value']);
  }
  const current=new Set(fields.map(field=>field.ref));
  for(const field of previous.data.fields)if(!current.has(field.ref))next.retiredFields.push(structuredClone(field));
  next.data={facts:structuredClone(previous.data.facts),fields};next.bindings=bindings;return next;
}

/** A save consumes the exact GET revisions, including per-target human revisions. */
export function applyLocalizationInput(id:string,source:Source,current:StoredLocalization,incoming:LocalizationData):StoredLocalization {
  const parsed=LocalizationDataSchema.parse(incoming);
  if(parsed.fields.length!==current.data.fields.length)throw conflict();
  const result=structuredClone(current);
  result.data.fields=current.data.fields.map(prior=>{
    const item=parsed.fields.find(field=>field.ref===prior.ref);
    if(!item||item.sourceText!==prior.sourceText||item.sourceHash!==prior.sourceHash||item.sourceVersion!==prior.sourceVersion)throw conflict();
    const changedLanguage=item.sourceLanguage!==prior.sourceLanguage;
    const field=structuredClone(item);
    field.sourceVersion=prior.sourceVersion+(changedLanguage?1:0);
    field.sourceHash=fieldHash(item.ref,current.bindings[item.ref]!,item.sourceLanguage,item.sourceText);
    for(const locale of locales){
      const value=field.translations[locale],old=prior.translations[locale];
      if(value && value.humanEditVersion!==(old?.humanEditVersion??0))throw conflict();
      if (value?.kind==='machine' && hasTranslationText(old) &&
          (old.kind==='human' || (old.reviewStatus==='approved' && value.text!==old.text))) throw conflict();
      if (!hasTranslationText(value)) { field.translations[locale]=null; continue; }
      if (value.kind==='machine'&&!value.engineVersion)throw new ApiError(400,'INVALID_REQUEST','Machine translations require provenance.');
      const retainsCatalog = old && old.engineVersion === value.engineVersion && old.kind === value.kind && old.text === value.text;
      if (!retainsCatalog && isConfigurationCatalogEngine(value.engineVersion) &&
          (value.kind!=='machine'||locale==='zh'||value.engineVersion!==CONFIGURATION_TRANSLATION_CATALOG_VERSION||
            configurationCatalogText(field.ref,field.sourceText,locale)!==value.text))
        throw new ApiError(400,'INVALID_REQUEST','Catalog provenance requires an exact configuration catalog entry.');
      if(changedLanguage||value.sourceVersion!==field.sourceVersion)value.reviewStatus='stale';
      const changed=!old||value.text!==old.text||value.kind!==old.kind||value.reviewStatus!==old.reviewStatus||value.sourceVersion!==old.sourceVersion;
      value.humanEditVersion=(old?.humanEditVersion??0)+(changed?1:0);
    }
    if (changedLanguage && isChineseSource(field.sourceLanguage) && !hasTranslationText(field.translations.zh)) field.translations.zh={text:field.sourceText,kind:'original',reviewStatus:'pending',sourceVersion:field.sourceVersion,humanEditVersion:(prior.translations.zh?.humanEditVersion??0)+1,engineVersion:null};
    return field;
  });
  result.data.facts={generation:structuredClone(parsed.facts.generation),drivetrain:parsed.facts.drivetrain,
    ...(current.data.facts.verifiedTechnical ? {verifiedTechnical:structuredClone(current.data.facts.verifiedTechnical)} : {})};
  // A generation edit creates/invalidates its bound field; existing refs are never guessed by the client.
  return syncLocalization(id,source,result,'zh');
}

export const missingDisplay=(locale:Locale):DisplayText=>({text:null,requestedLocale:locale,contentLocale:null,status:'missing',provenance:null,reviewed:false});
export function resolveDisplay(field:DisplayField|undefined,locale:Locale,manual:boolean):DisplayText{
  const value=field?.translations[locale];
  if(!field||!hasTranslationText(value))return missingDisplay(locale);
  return {text:value.text,requestedLocale:locale,contentLocale:value.kind==='original'?field.sourceLanguage:locale,status:'ready',provenance:value.kind,reviewed:manual&&value.reviewStatus==='approved'};
}
export type DisplayProjection=Pick<PublicVehicle,'facts'|'price'|'images'|'source'|'display'|'configuration'>;
export function projectDisplay(id:string,source:Source,locale:Locale,saved?:PublishedLocalization):DisplayProjection {
  const price=PublicPriceSchema.parse(source.price);
  // The published sidecar is immutable. An old projection may have hidden text,
  // but the counterpart in the archived sidecar remains authoritative.
  const state=saved?.data??syncLocalization(id,source).data;
  const manual=source.source.kind==='manual';const byRef=new Map(state.fields.map(field=>[field.ref,field]));
  const get=(ref:string)=>resolveDisplay(byRef.get(ref),locale,manual);
  const brand=findBrand(source.facts.make);
  const make:DisplayText=brand?{text:brand.labels[locale],requestedLocale:locale,contentLocale:locale,status:'ready',provenance:'catalog',reviewed:true}:get('make');
  const display:VehicleDisplay={make,model:get('model'),trim:get('trim'),generation:get('generation'),city:get('location.city'),location:get('location.displayName'),platform:get('source.platform'),
    priceIncludes:state.fields.filter(field=>field.ref.startsWith('price.includes.')).map(field=>({id:field.ref.slice('price.includes.'.length),value:get(field.ref)})),
    mediaAlt:(source.media??source.images??[]).map(media=>({mediaId:media.id,value:get(`media.${media.id.toLowerCase()}.alt`)})),
  };
  const placeholder={zh:'待翻译',en:'Awaiting translation',ru:'Ожидает перевода'}[locale];
  const named=(value:{id:string;name:string}|null,label:DisplayText)=>value?{id:value.id,name:label.text??placeholder}:null;
  return {display, configuration: projectConfiguration(source.configuration,locale,get),
    facts:{...source.facts,make:named(source.facts.make,display.make),model:named(source.facts.model,display.model),trim:named(source.facts.trim,display.trim),
      generation:named(state.facts.generation,display.generation),drivetrain:state.facts.drivetrain,
      location:source.facts.location?{country:source.facts.location.country,city:display.city.text,displayName:display.location.text}:null},
    price:{...price,includes:display.priceIncludes.flatMap(item=>item.value.text?[item.value.text]:[])},
    images:(source.images??[]).map(media=>({...media,alt:get(`media.${media.id.toLowerCase()}.alt`).text??''})),
    source:source.source.kind==='external'?{kind:'external',listingUrl:source.source.listingUrl,platform:{id:source.source.platform.id,name:display.platform.text??placeholder}}:{kind:source.source.kind},
  };
}
