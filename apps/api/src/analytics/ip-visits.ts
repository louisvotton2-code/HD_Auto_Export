import {createHmac,timingSafeEqual} from 'node:crypto';
import {BlockList,isIP} from 'node:net';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {
  AnalyticsIpVisitRequestSchema,analyticsIpVisitBodyLimit,analyticsIpVisitKeyHeader,analyticsIpVisitPath,
  type AnalyticsIpVisitQuality,type AnalyticsIpVisitRequest,
} from '@hd/contracts/analytics';
import type {Config} from '../config.js';
import {createDatabase} from '../db/index.js';
import {ApiError,notFound} from '../errors.js';
import {pruneIpVisits,recordIpVisit,recordIpVisitCoverage} from './ip-visits-store.js';

export function normalizeVisitAddress(value:string):string|undefined {
  const family=isIP(value);
  if(family===4)return value;
  if(family!==6||value.includes('%'))return undefined;
  const compressed=new URL(`http://[${value}]/`).hostname.slice(1,-1);
  const mapped=/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(compressed);
  if(!mapped)return compressed;
  const upper=Number.parseInt(mapped[1]!,16),lower=Number.parseInt(mapped[2]!,16);
  return [upper>>>8,upper&255,lower>>>8,lower&255].join('.');
}

function gatewayIdentity(config:NonNullable<Config['ipVisitService']>) {
  const peers=new BlockList();
  for(const value of config.peers) {
    const [address,bits]=value.split('/');
    const family=isIP(address!)===4?'ipv4':'ipv6';
    if(bits)peers.addSubnet(address!,Number(bits),family);
    else peers.addAddress(address!,family);
  }
  const secret=Buffer.from(config.gatewaySecret,'hex');
  return (request:FastifyRequest) => {
    const peer=request.raw.socket.remoteAddress;
    const key=request.headers[analyticsIpVisitKeyHeader];
    if(!peer||!isIP(peer)||!peers.check(peer,isIP(peer)===4?'ipv4':'ipv6')||
      typeof key!=='string'||!(/^[a-f0-9]{64}$/).test(key))return false;
    return timingSafeEqual(secret,Buffer.from(key,'hex'));
  };
}
const unavailable=()=>new ApiError(503,'SERVICE_UNAVAILABLE','Visit collection is temporarily unavailable.',undefined,true);

export function registerIpVisitRoutes(app:FastifyInstance,config:Config,
  optionalMaintenance:(action:()=>Promise<void>)=>Promise<void>) {
  const service=config.ipVisitService;
  const stats:AnalyticsIpVisitQuality={configured:Boolean(service),accepted:0,duplicates:0,rejected:0,rateLimited:0,unavailable:0,since:new Date().toISOString()};
  if(config.ipVisitsMisconfigured)app.log.warn('Optional IP visit collector is disabled by incomplete credentials or socket policy.');
  // Retention still runs when collection has been switched off.
  const poolLimit=2;
  const db=createDatabase(config.databaseUrl,poolLimit,false,250);
  let active=0,maintenanceRunning=false;
  const maintenance=config.environment==='test'?undefined:setInterval(()=>{
    if(maintenanceRunning)return;
    // Allow the next free slot to go to retention even when events arrive continuously.
    maintenanceRunning=true;
    void optionalMaintenance(()=>db.transaction(async tx=>{
      await tx.query("SET LOCAL statement_timeout='500ms'; SET LOCAL lock_timeout='100ms'");
      if(await pruneIpVisits(tx))app.log.warn('IP visit retention has an expired backlog.');
    })).catch((error: unknown)=>{
      const beforeMigration=!service&&typeof error==='object'&&error!==null&&'code' in error&&error.code==='42P01';
      if(!beforeMigration)app.log.warn('IP visit retention cleanup could not run.');
    }).finally(()=>{maintenanceRunning=false;});
  },60_000);
  maintenance?.unref();
  app.addHook('onClose',async()=>{
    if(maintenance)clearInterval(maintenance);
    await db.close();
  });
  if(service){
    const authorized=gatewayIdentity(service);
    const hashKey=Buffer.from(service.hashSecret,'hex');
    app.post(analyticsIpVisitPath,{
      config:{rateLimit:{max:1200,timeWindow:60_000}},
      bodyLimit:analyticsIpVisitBodyLimit,
      schema:{hide:true,body:AnalyticsIpVisitRequestSchema,querystring:z.strictObject({}),response:{204:z.undefined()}},
      onRequest:async request=>{
        if(!authorized(request)||request.headers.origin!==undefined||request.headers.cookie!==undefined||
          request.headers.referer!==undefined||request.headers.authorization!==undefined||request.headers['sec-fetch-site']!==undefined||
          request.headers.forwarded!==undefined||request.headers['x-forwarded-for']!==undefined)throw notFound();
        if(request.headers['content-type']?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')
          throw new ApiError(415,'INVALID_REQUEST','Gateway visits require JSON.');
      },
      onResponse:async(_request,reply)=>{
        if(reply.statusCode===429)stats.rateLimited++;
        else if(reply.statusCode>=500)stats.unavailable++;
        else if(reply.statusCode>=400)stats.rejected++;
      },
    },async(request,reply)=>{
      if(active>=poolLimit-Number(maintenanceRunning))throw unavailable();
      active++;
      try {
        const input=request.body as AnalyticsIpVisitRequest;
        if(input.kind==='document'){
          const address=normalizeVisitAddress(input.address);
          if(!address)throw new ApiError(400,'INVALID_REQUEST','Invalid gateway visit address.');
          const digest=createHmac('sha256',hashKey).update('hd-ip-visit-v1\0').update(address).digest();
          const result=await recordIpVisit(db,digest,input.observedAt).catch(()=>{throw unavailable();});
          if(result==='expired')throw new ApiError(400,'INVALID_REQUEST','Gateway visit is outside its delivery window.');
          if(result==='counted')stats.accepted++;
          else stats.duplicates++;
        }else{
          const result=await recordIpVisitCoverage(db,input.hour,input.status).catch(()=>{throw unavailable();});
          if(result==='expired')throw new ApiError(400,'INVALID_REQUEST','Gateway hour is outside its seal window.');
        }
        return reply.code(204).send();
      }finally{active--;}
    });
  }
  return ()=>({...stats});
}
