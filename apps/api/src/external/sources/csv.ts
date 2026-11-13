import { createHash } from 'node:crypto';

export const catalogColumns = ['source','id','make','model','trim','make_zh','model_zh','trim_zh','model_year','first_registration','mileage_km','price_cny','new_price_cny','city','fuel','transmission','displacement','power_hp','drivetrain','color','transfers','has_report','seller','seller_city','first_seen_at','last_seen_at','detail_fetched_at','export_price_usd','url','duplicate_of','manufacture_date','displacement_cc','power_kw','seller_price_cny','emission_standard','listed_at','vehicle_class','doors','seats','warranty','seller_rating','condition','valuation_min_cny','valuation_max_cny','manufacture_date_source','manufacture_earliest','manufacture_latest','vin'] as const;
export type CatalogCsvRow = Record<(typeof catalogColumns)[number], string>;
export type CatalogManifest = { sha256:string; bytes:number; rows:number; sourceCounts:Record<'che168'|'dongchedi',number>; generatedAt:string; complete:true };
export type CsvVerification = { expectedSha256:string; expectedBytes:number; generatedAt:string; expectedRows?:number; expectedSourceCounts?:Partial<CatalogManifest['sourceCounts']>; downloadCompleted:true };
/** onRow is staging-only. No row is eligible for business publication until this promise resolves. */
export async function verifyCatalogCsv(input:AsyncIterable<Uint8Array>, proof:CsvVerification, onRow:(row:CatalogCsvRow,index:number)=>Promise<void>|void):Promise<CatalogManifest> {
  if (!/^[a-f0-9]{64}$/.test(proof.expectedSha256) || !Number.isSafeInteger(proof.expectedBytes) || proof.expectedBytes<1 ||
      proof.downloadCompleted!==true || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(proof.generatedAt) || !Number.isFinite(Date.parse(proof.generatedAt))) throw new Error('A complete download manifest is required.');
  const hash=createHash('sha256'), decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0, rows=0, header=false, field='', fields:string[]=[], quoted=false, afterQuote=false, pendingCR=false, atStart=true;
  const sourceCounts={che168:0,dongchedi:0};
  const finishField=()=>{fields.push(field);field='';afterQuote=false;if(fields.length>catalogColumns.length)throw new Error('CSV has too many columns.');};
  const finishRow=async()=>{
    finishField();
    if(!header){if(fields.length!==catalogColumns.length||fields.some((v,i)=>v!==catalogColumns[i]))throw new Error('CSV header changed.');header=true;}
    else {if(fields.length!==catalogColumns.length)throw new Error('CSV row column count differs.');
      const row=Object.fromEntries(catalogColumns.map((key,i)=>[key,fields[i]!])) as CatalogCsvRow;
      if(!['che168','dongchedi'].includes(row.source)||!/^\d{1,100}$/.test(row.id))throw new Error('CSV source identity is invalid.');
      sourceCounts[row.source as keyof typeof sourceCounts]++;await onRow(row,rows++);
    } fields=[];
  };
  const consume=async(text:string)=>{for(const c of text){
    if(atStart){atStart=false;if(c==='\uFEFF')continue;}
    if(pendingCR){pendingCR=false;if(c!=='\n')throw new Error('CSV CR must be followed by LF.');continue;}
    if(quoted){if(c==='"'){quoted=false;afterQuote=true;}else field+=c;}
    else if(afterQuote&&c==='"'){field+='"';quoted=true;afterQuote=false;}
    else if(c===',')finishField();
    else if(c==='\n'||c==='\r'){await finishRow();if(c==='\r')pendingCR=true;}
    else if(afterQuote)throw new Error('CSV contains characters after a closing quote.');
    else if(c==='"'){if(field)throw new Error('CSV quote appears inside an unquoted field.');quoted=true;}
    else field+=c;
    if(field.length>1_048_576)throw new Error('CSV field exceeds bounded parser capacity.');
  }};
  for await(const chunk of input){bytes+=chunk.byteLength;if(bytes>proof.expectedBytes)throw new Error('CSV byte count differs.');hash.update(chunk);await consume(decoder.decode(chunk,{stream:true}));}
  await consume(decoder.decode());
  if(quoted||pendingCR)throw new Error('CSV ended inside an unfinished record.');
  if(field||fields.length||afterQuote)await finishRow();
  const sha256=hash.digest('hex');
  if(!header||rows===0||bytes!==proof.expectedBytes||sha256!==proof.expectedSha256||proof.expectedRows!==undefined&&rows!==proof.expectedRows||
    Object.entries(proof.expectedSourceCounts??{}).some(([source,count])=>sourceCounts[source as keyof typeof sourceCounts]!==count)) throw new Error('CSV completeness validation failed.');
  return {sha256,bytes,rows,sourceCounts,generatedAt:new Date(proof.generatedAt).toISOString(),complete:true};
}
