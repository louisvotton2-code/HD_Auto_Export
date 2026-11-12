import {createHash} from 'node:crypto';
import {findBrand,LocalizationDataSchema,type DisplayField,type LocalizationData,type VehicleDraftInput} from '@hd/contracts/admin';
import {PublicPriceSchema,type DisplayText,type Locale,type PublicVehicle,type VehicleDisplay} from '@hd/contracts/public';
import {conflict,ApiError} from '../errors.js';
import {locales} from './content.js';

type Source=Pick<VehicleDraftInput,'source'|'facts'|'price'> & {media?:VehicleDraftInput['media'];images?:PublicVehicle['images']};
export type StoredLocalization={revision:number;data:LocalizationData;bindings:Record<string,string>;retiredFields:DisplayField[]};
export type PublishedLocalization=Pick<StoredLocalization,'data'|'bindings'>;
export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const emptyLocalization=():StoredLocalization=>({revision:0,data:{facts:{generation:null,drivetrain:null},fields:[]},bindings:{},retiredFields:[]});
const stableId=(input:unknown)=>{const hex=digest(input);return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;};
const fieldHash=(ref:string,binding:string,language:string,text:string)=>digest([ref,binding,language,text]);

/** Derive only explicitly public raw fields. GET computes this without persisting anything. */
export function syncLocalization(id:string,source:Source,previous:StoredLocalization=emptyLocalization()):StoredLocalization {
  id=id.toLowerCase();
  const next=structuredClone(previous);const fields:DisplayField[]=[];const bindings:Record<string,string>={};
  const old=new Map(previous.data.fields.map(field=>[field.ref,field]));
  const add=(ref:string,text:string|null|undefined,identity:unknown)=>{
    if(!text?.trim())return;
    const binding=digest(identity);bindings[ref]=binding;
    const prior=old.get(ref);const language=prior?.sourceLanguage??'und';
    const hash=fieldHash(ref,binding,language,text);
    if(prior) {
      const field=structuredClone(prior);
      if(prior.sourceHash!==hash){field.sourceVersion++;for(const value of Object.values(field.translations))if(value)value.reviewStatus='stale';}
      field.sourceText=text;field.sourceHash=hash;fields.push(field);
    } else fields.push({ref,sourceText:text,sourceLanguage:language,sourceVersion:1,sourceHash:hash,translations:{zh:null,en:null,ru:null}});
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
      const value=field.translations[locale],old=prior.translations[locale];if(!value)continue;
      if(value.humanEditVersion!==(old?.humanEditVersion??0))throw conflict();
      if(value.sourceVersion!==prior.sourceVersion&&value.sourceVersion!==old?.sourceVersion)throw conflict();
      if(value.kind==='machine'&&old&&(old.kind==='human'||old.reviewStatus==='approved')&&value.text!==old.text)throw conflict();
      if(value.kind==='machine'&&!value.engineVersion)throw new ApiError(400,'INVALID_REQUEST','Machine translations require provenance.');
      if(changedLanguage||value.sourceVersion!==field.sourceVersion)value.reviewStatus='stale';
      if(value.kind==='original'&&(locale!==field.sourceLanguage.split('-')[0]||value.text!==field.sourceText)&&value.reviewStatus!=='stale')
        throw new ApiError(400,'INVALID_REQUEST','Original display text must match its declared language and source.');
      const changed=!old||value.text!==old.text||value.kind!==old.kind||value.reviewStatus!==old.reviewStatus||value.sourceVersion!==old.sourceVersion;
      value.humanEditVersion=(old?.humanEditVersion??0)+(changed?1:0);
    }
    return field;
  });
  result.data.facts=structuredClone(parsed.facts);
  // A generation edit creates/invalidates its bound field; existing refs are never guessed by the client.
  return syncLocalization(id,source,result);
}

export function validateLocalizationPublication(data:LocalizationData,manual:boolean){
  const failures=[];
  for(const field of data.fields)for(const locale of locales){
    const value=field.translations[locale];
    if(!value||value.sourceVersion!==field.sourceVersion||(manual?value.reviewStatus!=='approved':value.reviewStatus==='stale'))
      failures.push({path:`localization.${field.ref}.${locale}`,code:'REQUIRED_FOR_PUBLICATION',message:'A current display translation is required before publication.'});
  }
  if(failures.length)throw new ApiError(422,'PUBLISH_VALIDATION_FAILED','Display localization is not ready to publish.',failures.slice(0,100));
}
export const missingDisplay=(locale:Locale):DisplayText=>({text:null,requestedLocale:locale,contentLocale:null,status:'missing',provenance:null,reviewed:false});
export function resolveDisplay(field:DisplayField|undefined,locale:Locale,manual:boolean):DisplayText{
  const value=field?.translations[locale];
  if(!field||!value||value.sourceVersion!==field.sourceVersion||(manual?value.reviewStatus!=='approved':value.reviewStatus==='stale'))return missingDisplay(locale);
  return {text:value.text,requestedLocale:locale,contentLocale:value.kind==='original'?field.sourceLanguage:locale,status:'ready',provenance:value.kind,reviewed:manual&&value.reviewStatus==='approved'};
}
export type DisplayProjection=Pick<PublicVehicle,'facts'|'price'|'images'|'source'|'display'>;
export function projectDisplay(id:string,source:Source,locale:Locale,saved?:PublishedLocalization):DisplayProjection {
  const price=PublicPriceSchema.parse(source.price);
  const state=syncLocalization(id,source,saved?{...saved,revision:1,retiredFields:[]}:undefined);
  const manual=source.source.kind==='manual';const byRef=new Map(state.data.fields.map(field=>[field.ref,field]));
  const get=(ref:string)=>resolveDisplay(byRef.get(ref),locale,manual);
  const brand=findBrand(source.facts.make);
  const make:DisplayText=brand?{text:brand.labels[locale],requestedLocale:locale,contentLocale:locale,status:'ready',provenance:'catalog',reviewed:true}:get('make');
  const display:VehicleDisplay={make,model:get('model'),trim:get('trim'),generation:get('generation'),city:get('location.city'),location:get('location.displayName'),platform:get('source.platform'),
    priceIncludes:state.data.fields.filter(field=>field.ref.startsWith('price.includes.')).map(field=>({id:field.ref.slice('price.includes.'.length),value:get(field.ref)})),
    mediaAlt:(source.media??source.images??[]).map(media=>({mediaId:media.id,value:get(`media.${media.id.toLowerCase()}.alt`)})),
  };
  const placeholder={zh:'待翻译',en:'Awaiting translation',ru:'Ожидает перевода'}[locale];
  const named=(value:{id:string;name:string}|null,label:DisplayText)=>value?{id:value.id,name:label.text??placeholder}:null;
  return {display,
    facts:{...source.facts,make:named(source.facts.make,display.make),model:named(source.facts.model,display.model),trim:named(source.facts.trim,display.trim),
      generation:named(state.data.facts.generation,display.generation),drivetrain:state.data.facts.drivetrain,
      location:source.facts.location?{country:source.facts.location.country,city:display.city.text,displayName:display.location.text}:null},
    price:{...price,includes:display.priceIncludes.flatMap(item=>item.value.text?[item.value.text]:[])},
    images:(source.images??[]).map(media=>({...media,alt:get(`media.${media.id.toLowerCase()}.alt`).text??''})),
    source:source.source.kind==='external'?{kind:'external',listingUrl:source.source.listingUrl,platform:{id:source.source.platform.id,name:display.platform.text??placeholder}}:{kind:source.source.kind},
  };
}
