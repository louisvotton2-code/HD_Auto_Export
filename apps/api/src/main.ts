import { readConfig } from './config.js';
import { buildApp } from './app.js';

const config=readConfig(process.env,{runtime:true});
const {app}=await buildApp(config,{logger:true});
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void app.close();});
await app.listen({host:config.host,port:config.port});
