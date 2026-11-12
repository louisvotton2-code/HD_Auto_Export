import {z} from 'zod';
import {LanguageTagSchema,LocaleSchema,NamedValueSchema,VersionSchema,responseSchema} from './common.js';

export const DrivetrainSchema=z.enum(['fwd','rwd','awd','four_wd']);
export type Drivetrain=z.infer<typeof DrivetrainSchema>;
export const VehicleExtraFactsSchema=z.strictObject({generation:NamedValueSchema.nullable(),drivetrain:DrivetrainSchema.nullable()});
export type VehicleExtraFacts=z.infer<typeof VehicleExtraFactsSchema>;
/** Keep localized projections within the original field's public contract. Never truncate translations. */
export function getDisplayTextLimit(ref:string):number {
  if(ref.startsWith('configuration.'))return ref.endsWith('.name')?100:500;
  if(ref.startsWith('media.'))return 500;
  if(ref==='location.displayName'||ref.startsWith('price.includes.'))return 200;
  return 120;
}
export const DisplayRefSchema=z.string().max(450).regex(/^(?:make|model|trim|generation|location\.city|location\.displayName|source\.platform|media\.[0-9a-f-]{36}\.alt|price\.includes\.[0-9a-f-]{36}|configuration\.cfg-(?:[0-9a-f]{4}){1,100}\.(?:name|value))$/).refine(ref=>{
  if(ref.startsWith('media.'))return z.uuid().safeParse(ref.slice(6,-4)).success;
  if(ref.startsWith('price.includes.'))return z.uuid().safeParse(ref.slice(15)).success;
  return true;
});
export const DisplayTranslationSchema=z.strictObject({
  text:z.string().min(1).max(500).regex(/\S/),kind:z.enum(['original','machine','human']),
  reviewStatus:z.enum(['pending','approved','stale']),sourceVersion:VersionSchema,
  humanEditVersion:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),engineVersion:z.string().min(1).max(200).nullable(),
});
export const DisplayFieldSchema=z.strictObject({
  ref:DisplayRefSchema,sourceLanguage:LanguageTagSchema,sourceText:z.string().min(1).max(500).regex(/\S/),
  sourceVersion:VersionSchema,sourceHash:z.string().regex(/^[a-f0-9]{64}$/),
  translations:z.strictObject({zh:DisplayTranslationSchema.nullable(),en:DisplayTranslationSchema.nullable(),ru:DisplayTranslationSchema.nullable()}),
}).superRefine((field,ctx)=>{
  const max=getDisplayTextLimit(field.ref);
  if(field.sourceText.length>max)ctx.addIssue({code:'custom',path:['sourceText'],message:`This display field is limited to ${max} characters`});
  for(const locale of ['zh','en','ru'] as const)if((field.translations[locale]?.text.length??0)>max)
    ctx.addIssue({code:'custom',path:['translations',locale,'text'],message:`This display field is limited to ${max} characters`});
});
export type DisplayField=z.infer<typeof DisplayFieldSchema>;
export const LocalizationDataSchema=z.strictObject({facts:VehicleExtraFactsSchema,fields:z.array(DisplayFieldSchema).max(470)}).superRefine((value,ctx)=>{
  if(new Set(value.fields.map(field=>field.ref)).size!==value.fields.length)ctx.addIssue({code:'custom',path:['fields'],message:'Duplicate display refs'});
});
export type LocalizationData=z.infer<typeof LocalizationDataSchema>;
export const VehicleLocalizationSchema=z.strictObject({
  vehicleId:z.uuid(),vehicleVersion:VersionSchema,revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  data:LocalizationDataSchema,retiredFieldCount:z.number().int().nonnegative(),
});
export type VehicleLocalization=z.infer<typeof VehicleLocalizationSchema>;
export const VehicleLocalizationResponseSchema=responseSchema(VehicleLocalizationSchema);
export const SaveVehicleLocalizationSchema=z.strictObject({
  vehicleVersion:VersionSchema,revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),data:LocalizationDataSchema,
});
export type SaveVehicleLocalization=z.infer<typeof SaveVehicleLocalizationSchema>;
export const GenerateDisplayTranslationsSchema=z.strictObject({
  vehicleVersion:VersionSchema,revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  refs:z.array(DisplayRefSchema).min(1).max(10).refine(refs=>new Set(refs).size===refs.length),
});
export type GenerateDisplayTranslations=z.infer<typeof GenerateDisplayTranslationsSchema>;
export const DisplayTranslationSuggestionsSchema=z.strictObject({
  vehicleId:z.uuid(),vehicleVersion:VersionSchema,revision:z.number().int().nonnegative(),
  fields:z.array(DisplayFieldSchema).min(1).max(10),
});
export type DisplayTranslationSuggestions=z.infer<typeof DisplayTranslationSuggestionsSchema>;
export const DisplayTranslationSuggestionsResponseSchema=responseSchema(DisplayTranslationSuggestionsSchema);

/** Public metadata contains no original text, source hashes, engine IDs or task details. */
export const DisplayTextSchema=z.discriminatedUnion('status',[
  z.strictObject({status:z.literal('ready'),text:z.string().min(1).max(500).regex(/\S/),requestedLocale:LocaleSchema,contentLocale:LanguageTagSchema,
    provenance:z.enum(['catalog','original','machine','human','supplier']),reviewed:z.boolean()}),
  z.strictObject({status:z.literal('missing'),text:z.null(),requestedLocale:LocaleSchema,contentLocale:z.null(),provenance:z.null(),reviewed:z.literal(false)}),
]);
export type DisplayText=z.infer<typeof DisplayTextSchema>;
export const VehicleDisplaySchema=z.strictObject({
  make:DisplayTextSchema,model:DisplayTextSchema,trim:DisplayTextSchema,generation:DisplayTextSchema,
  city:DisplayTextSchema,location:DisplayTextSchema,platform:DisplayTextSchema,
  priceIncludes:z.array(z.strictObject({id:z.uuid(),value:DisplayTextSchema})).max(30),
  mediaAlt:z.array(z.strictObject({mediaId:z.string(),value:DisplayTextSchema})).max(30),
});
export type VehicleDisplay=z.infer<typeof VehicleDisplaySchema>;
