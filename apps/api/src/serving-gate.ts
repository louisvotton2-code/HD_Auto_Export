import {readLocalSecret} from './local-secrets.js';
import {ApiError} from './errors.js';
export type ServingMode='active'|'candidate'|'draining';
/** Per-slot control file is mounted by directory, so an atomic rename is visible without restarting the API. */
export class ServingGate {
 private requests=new Map<object,'admitted'|'handling'>();
 constructor(readonly file?:string){}
 mode():ServingMode {
  if(!this.file)return 'active';
  try{const mode=readLocalSecret(this.file,32);return mode==='active'||mode==='candidate'||mode==='draining'?mode:'candidate';}
  catch{return 'candidate';}
 }
 enter(request:object,method:string,route:string){
  const effect=!['GET','HEAD'].includes(method)||route.startsWith('/api/auth/')||route.startsWith('/api/v1/admin/');
  if(!effect)return;
  if(this.mode()!=='active')throw new ApiError(503,'SERVICE_UNAVAILABLE','This API slot is not accepting staff operations.',undefined,true);
  this.requests.set(request,'admitted');
 }
 handling(request:object){if(this.requests.has(request))this.requests.set(request,'handling');}
 finish(request:object){this.requests.delete(request);}
 response(request:object){if(this.requests.get(request)==='admitted')this.finish(request);}
 async optionalEffect(work:()=>Promise<unknown>){
  // Mode read + admission happen synchronously, so draining observes every admitted short public write.
  if(this.mode()!=='active')return;
  const token={};this.requests.set(token,'handling');
  try{await work();}finally{this.finish(token);}
 }
 status(){return {mode:this.mode(),inFlight:this.requests.size};}
}
