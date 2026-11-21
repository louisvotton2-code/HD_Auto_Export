/** Lossy, bounded read hints. No queue and no response wait; SQL still enforces the cross-process hour limit. */
export class FullSyncAccessHints {
 private seen=new Map<string,number>();
 private pending=new Set<Promise<void>>();
 private closed=false;
 constructor(private write:(id:string)=>Promise<unknown>,private admit:(work:()=>Promise<unknown>)=>Promise<unknown>,private now:()=>number=Date.now){}
 hint(id:string):void{
  if(this.closed||this.pending.size>=2)return;
  const now=this.now();if((this.seen.get(id)??0)>now)return;
  if(this.seen.size>=2048){for(const [key,until] of this.seen)if(until<=now)this.seen.delete(key);if(this.seen.size>=2048)return;}
  this.seen.set(id,now+3_600_000);let started=false;
  // Admission stays synchronous so ServingGate draining accounts for the detached operation.
  const task=this.admit(async()=>{started=true;await this.write(id);}).then(()=>{},()=>{this.seen.delete(id);})
   .finally(()=>{if(!started)this.seen.delete(id);this.pending.delete(task);});
  this.pending.add(task);
 }
 async close(){this.closed=true;await Promise.allSettled(this.pending);}
}
