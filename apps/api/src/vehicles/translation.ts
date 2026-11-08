import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { TranslatableField, VehicleTranslationSuggestionField, VehicleTranslationSuggestions,DisplayField } from '@hd/contracts/admin';
import { VehicleTranslationSuggestionsSchema,getDisplayTextLimit } from '@hd/contracts/admin';
import type { Config } from '../config.js';
import { ApiError } from '../errors.js';
import { locales, sourceHash } from './content.js';

export interface TranslationProvider {
  readonly engineVersion:string;
  translate(text:string,target:'en'|'ru',signal:AbortSignal):Promise<string>;
}
const ALI_MT_ENDPOINTS={
  'cn-hangzhou':'https://mt.cn-hangzhou.aliyuncs.com/',
  'ap-southeast-1':'https://mt.ap-southeast-1.aliyuncs.com/',
} as const;
const encode=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
/** Alibaba RPC v2: all decoded query and form parameters except Signature participate. */
export function rpcSignature(params:Record<string,string>,secret:string):string {
  const canonical=Object.keys(params).filter(key=>key!=='Signature').sort().map(key=>`${encode(key)}=${encode(params[key]!)}`).join('&');
  return createHmac('sha1',`${secret}&`).update(`POST&%2F&${encode(canonical)}`).digest('base64');
}
const upstream=()=>new ApiError(503,'TRANSLATION_UPSTREAM_FAILED','Translation service did not return a usable result.',undefined,true);
/** A joining request may stop waiting without cancelling another request's shared provider work. */
function waitWithSignal<T>(work:Promise<T>,signal:AbortSignal):Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve,reject)=>{
    const stop=()=>{signal.removeEventListener('abort',stop);reject(signal.reason);};
    signal.addEventListener('abort',stop,{once:true});
    work.then(value=>{
      signal.removeEventListener('abort',stop);
      if(signal.aborted)reject(signal.reason);else resolve(value);
    },error=>{signal.removeEventListener('abort',stop);reject(error);});
  });
}
async function readUpstream(response:Response):Promise<unknown> {
  if(!response.ok || !response.body)throw upstream();
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try {for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>150_000)throw upstream();chunks.push(part.value);}}
  finally{await reader.cancel();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function usableText(value:unknown,source:string):string {
  if(typeof value!=='string' || !value.trim() || value.length>10_000 || (value===source && /\p{Script=Han}/u.test(source)))throw upstream();
  return value;
}

/** Self-hosted adapter: only a server-configured local service can receive text. */
export class LibreTranslateProvider implements TranslationProvider {
  readonly engineVersion:string;
  constructor(private config:Config['translation'],private fetcher:typeof fetch=fetch) {
    this.engineVersion=`libretranslate:${config.libreEngineVersion}`;
  }
  async translate(text:string,target:'en'|'ru',signal:AbortSignal):Promise<string> {
    if(!this.config.libreUrl || !this.config.libreEngineVersion)throw new ApiError(503,'TRANSLATION_DISABLED','The local translation service is not configured.');
    if(!text || text.length>5000)throw new ApiError(422,'TRANSLATION_INPUT_TOO_LONG','A translation segment exceeds 5000 characters.');
    try {
      const response=await this.fetcher(new URL('/translate',this.config.libreUrl),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({q:text,source:'zh',target,format:'text',...(this.config.libreApiKey?{api_key:this.config.libreApiKey}:{})}),
        signal:AbortSignal.any([signal,AbortSignal.timeout(12_000)])});
      const result=await readUpstream(response) as {translatedText?:unknown};return usableText(result.translatedText,text);
    }catch(error){if(error instanceof ApiError)throw error;throw upstream();}
  }
}

export class AliyunGeneralProvider implements TranslationProvider {
  readonly engineVersion:string;
  private readonly region:Config['translation']['region'];
  constructor(private config:Config['translation'],private fetcher:typeof fetch=fetch) {
    this.region=config.region;
    this.engineVersion=`aliyun-general:2018-10-12:general:${this.region}:${config.configVersion}`;
  }
  async translate(text:string,target:'en'|'ru',signal:AbortSignal):Promise<string> {
    if(!this.config.accessKeyId || !this.config.accessKeySecret) throw new ApiError(503,'TRANSLATION_DISABLED','Translation credentials are not configured.');
    if(!text || text.length>5000) throw new ApiError(422,'TRANSLATION_INPUT_TOO_LONG','A translation segment exceeds 5000 characters.');
    const query:Record<string,string>={Action:'TranslateGeneral',Version:'2018-10-12',Format:'JSON',RegionId:this.region,
      AccessKeyId:this.config.accessKeyId,SignatureMethod:'HMAC-SHA1',SignatureVersion:'1.0',
      SignatureNonce:randomUUID(),Timestamp:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),
      ...(this.config.securityToken?{SecurityToken:this.config.securityToken}:{})};
    const form={FormatType:'text',SourceLanguage:'zh',TargetLanguage:target,SourceText:text,Scene:'general'};
    query.Signature=rpcSignature({...query,...form},this.config.accessKeySecret);
    try {
      const response=await this.fetcher(`${ALI_MT_ENDPOINTS[this.region]}?${new URLSearchParams(query)}`,{method:'POST',redirect:'error',
        headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form),
        signal:AbortSignal.any([signal,AbortSignal.timeout(7000)])});
      // Bound even a malformed upstream response; never reflect its messages or request URL.
      const raw=await readUpstream(response);
      if(!raw || typeof raw!=='object' || Array.isArray(raw))throw upstream();
      const envelope=raw as Record<string,unknown>;
      // International documentation also shows this exact one-level envelope. Never search arbitrary nested data.
      const body=Object.hasOwn(envelope,'TranslateGeneralResponse')?envelope.TranslateGeneralResponse:envelope;
      if(Object.hasOwn(envelope,'TranslateGeneralResponse') && Object.keys(envelope).length!==1)throw upstream();
      if(!body || typeof body!=='object' || Array.isArray(body))throw upstream();
      const result=body as {Code?:unknown;Data?:{Translated?:unknown}};
      // The international endpoint also returns the exact string "200" in successful responses.
      if(result.Code!==200 && result.Code!=='200') throw upstream();
      // Never disguise an untranslated Chinese source as successful machine output.
      return usableText(result.Data?.Translated,text);
    } catch(error) {if(error instanceof ApiError)throw error;throw upstream();}
  }
}

/** UTF-16 length is a conservative bound on the provider's 5000-character limit; no text is discarded. */
export function splitTranslationText(text:string):string[] {
  const chunks:string[]=[];let chunk='';
  for(const char of text) {if(chunk.length+char.length>5000){chunks.push(chunk);chunk='';}chunk+=char;}
  if(chunk)chunks.push(chunk);return chunks;
}

export class VehicleTranslator {
  private active=0;
  private windowStart=Date.now();private usedCharacters=0;
  private cache=new Map<string,{text:string;expiresAt:number}>();
  private inFlight=new Map<string,Promise<string>>();
  constructor(private provider:TranslationProvider|null,private maxCharactersPerHour=50_000) {}
  async generateDisplay(fields:DisplayField[]):Promise<DisplayField[]> {
    if(!fields.length||fields.length>10||fields.some(field=>!/^zh(?:-|$)/i.test(field.sourceLanguage)))
      throw new ApiError(422,'TRANSLATION_SOURCE_UNSUPPORTED','Save explicitly Chinese public display fields before generating suggestions.');
    if(!this.provider)throw new ApiError(503,'TRANSLATION_DISABLED','Machine translation is disabled or not configured.');
    if(this.active>=2)throw new ApiError(503,'TRANSLATION_BUSY','Translation capacity is busy. Try again shortly.',undefined,true);
    this.active++;
    try {
      const signal=AbortSignal.timeout(25_000);const results:DisplayField[]=[];
      for(const field of fields){
        const en=await this.text(field,'en',signal),ru=await this.text(field,'ru',signal);
        if(en.length>getDisplayTextLimit(field.ref)||ru.length>getDisplayTextLimit(field.ref))throw upstream();
        results.push({...field,translations:{
          zh:{text:field.sourceText,kind:'original',reviewStatus:'pending',sourceVersion:field.sourceVersion,humanEditVersion:field.translations.zh?.humanEditVersion??0,engineVersion:null},
          en:{text:en,kind:'machine',reviewStatus:'pending',sourceVersion:field.sourceVersion,humanEditVersion:field.translations.en?.humanEditVersion??0,engineVersion:this.provider.engineVersion},
          ru:{text:ru,kind:'machine',reviewStatus:'pending',sourceVersion:field.sourceVersion,humanEditVersion:field.translations.ru?.humanEditVersion??0,engineVersion:this.provider.engineVersion},
        }});
      }
      return results;
    } catch(error) {if(error instanceof ApiError)throw error;throw upstream();}
    finally {this.active--;}
  }
  private async text(field:TranslatableField,target:'en'|'ru',signal:AbortSignal):Promise<string> {
    signal.throwIfAborted();
    const key=createHash('sha256').update(JSON.stringify([this.provider!.engineVersion,sourceHash(field),target])).digest('hex');
    const cached=this.cache.get(key);if(cached && cached.expiresAt>Date.now())return cached.text;
    const ongoing=this.inFlight.get(key);if(ongoing)return waitWithSignal(ongoing,signal);
    const work=(async()=>{
      const source=field.sourceText!;
      signal.throwIfAborted();
      if(Date.now()-this.windowStart>=3_600_000){this.windowStart=Date.now();this.usedCharacters=0;}
      if(this.usedCharacters+source.length>this.maxCharactersPerHour)throw new ApiError(429,'TRANSLATION_QUOTA_EXCEEDED','The local hourly translation character budget is exhausted.');
      this.usedCharacters+=source.length; // Failed calls may still be billed; reserve before sending.
      const chunks:string[]=[];
      for(const part of splitTranslationText(source)) {
        signal.throwIfAborted();chunks.push(await this.provider!.translate(part,target,signal));signal.throwIfAborted();
      }
      const text=chunks.join('');if(text.length>10_000)throw upstream();
      signal.throwIfAborted();
      if(this.cache.size>=128)this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key,{text,expiresAt:Date.now()+24*3_600_000});return text;
    })();
    this.inFlight.set(key,work);try{return await work;}finally{this.inFlight.delete(key);}
  }
  async generate(vehicle:{id:string;version:number;draft:{content:{title:TranslatableField;description:TranslatableField}}}):Promise<VehicleTranslationSuggestions> {
    for(const [name,field] of Object.entries(vehicle.draft.content)) {
      if((name==='title' && !field.sourceText?.trim()) || (field.sourceText!==null && (!field.sourceText.trim() || !/^zh(?:-|$)/i.test(field.sourceLanguage))))
        throw new ApiError(422,'TRANSLATION_SOURCE_UNSUPPORTED','Save a Chinese source title and Chinese description before generating translations.');
    }
    if(!this.provider)throw new ApiError(503,'TRANSLATION_DISABLED','Machine translation is disabled or not configured.');
    if(this.active>=2)throw new ApiError(503,'TRANSLATION_BUSY','Translation capacity is busy. Try again shortly.',undefined,true);
    this.active++;
    try {
      const signal=AbortSignal.timeout(25_000);const engineVersion=this.provider.engineVersion;
      const field=async(input:TranslatableField):Promise<VehicleTranslationSuggestionField>=>{
        const en=await this.text(input,'en',signal);const ru=await this.text(input,'ru',signal);
        return {sourceLanguage:input.sourceLanguage,sourceText:input.sourceText!,sourceVersion:input.sourceVersion,sourceHash:sourceHash(input),
          targetHumanEditVersions:{zh:input.translations.zh?.humanEditVersion??null,en:input.translations.en?.humanEditVersion??null,ru:input.translations.ru?.humanEditVersion??null},
          translations:{zh:{text:input.sourceText!,kind:'original',reviewStatus:'pending',sourceVersion:input.sourceVersion,humanEditVersion:input.translations.zh?.humanEditVersion??0,engineVersion:null},
            en:{text:en,kind:'machine',reviewStatus:'pending',sourceVersion:input.sourceVersion,humanEditVersion:input.translations.en?.humanEditVersion??0,engineVersion},
            ru:{text:ru,kind:'machine',reviewStatus:'pending',sourceVersion:input.sourceVersion,humanEditVersion:input.translations.ru?.humanEditVersion??0,engineVersion}}};
      };
      // Sequential fields bound provider concurrency and preserve a single request deadline.
      const title=await field(vehicle.draft.content.title);
      const description=vehicle.draft.content.description.sourceText===null?null:await field(vehicle.draft.content.description);
      signal.throwIfAborted();
      return VehicleTranslationSuggestionsSchema.parse({vehicleId:vehicle.id,version:vehicle.version,engineVersion,content:{title,description}});
    } catch(error) {if(error instanceof ApiError)throw error;throw upstream();}
    finally{this.active--;}
  }
}

export function createVehicleTranslator(config:Config['translation']):VehicleTranslator {
  const provider=config.provider==='libretranslate' && config.libreUrl && config.libreEngineVersion?new LibreTranslateProvider(config):
    config.provider==='aliyun' && config.accessKeyId && config.accessKeySecret?new AliyunGeneralProvider(config):null;
  return new VehicleTranslator(provider,config.maxCharactersPerHour);
}
