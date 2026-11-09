import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { buildApp } from '../app.js';
import { readConfig, type Config } from '../config.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PublicFailureDiagnostic } from '../db/index.js';

const base = 'locale=en&view=localized&catalog=curated';
const usd = `${base}&priceView=usd&priceCurrency=USD&priceMin=8000&priceMax=17000`;
const scenarios = {
  list: [`/api/v1/vehicles?${base}&pageSize=24`],
  facets: [`/api/v1/vehicle-filters?${base}`],
  common: [`/api/v1/vehicles?${base}&make=toyota&pageSize=24`, `/api/v1/vehicle-filters?${base}&make=toyota`],
  rare: [`/api/v1/vehicles?${base}&make=scale-rare&pageSize=24`, `/api/v1/vehicle-filters?${base}&make=scale-rare`],
  usd: [`/api/v1/vehicles?${usd}&make=toyota&pageSize=24`, `/api/v1/vehicle-filters?${usd}&make=toyota`],
  mixed: [`/api/v1/vehicles?${base}&pageSize=24`, `/api/v1/vehicle-filters?${base}&make=toyota`,
    `/api/v1/vehicles?${base}&powertrain=bev&yearMin=2020&priceMin=60000&priceMax=120000&priceCurrency=CNY`,
    `/api/v1/vehicle-filters?${base}&make=scale-rare`],
} as const;
type Scenario = keyof typeof scenarios;

type Measurements = { latencies: number[]; statuses: Record<number, number>; requests: number };
const measurements = (): Measurements => ({latencies:[],statuses:{},requests:0});
function record(result: Measurements, status: number, latency: number) {
  result.requests++;
  result.statuses[status] = (result.statuses[status] ?? 0) + 1;
  if (status === 200) result.latencies.push(latency);
}
function report(result: Measurements) {
  const sorted = result.latencies.sort((a,b) => a-b);
  const percentile = (p: number) => sorted.length ? Math.round(sorted[Math.ceil(sorted.length*p)-1]! * 10)/10 : null;
  return {requests:result.requests,successes:sorted.length,statuses:result.statuses,
    p50Ms:percentile(.5),p95Ms:percentile(.95),p99Ms:percentile(.99),errorRate:1-sorted.length/result.requests};
}

export function capacityFailureCollector(pathCount: number) {
  const activePath = new AsyncLocalStorage<number>();
  const failures = Array.from({length:pathCount}, () => new Map<string, PublicFailureDiagnostic & {count:number}>());
  let unattributed = 0;
  return {
    observe(event: PublicFailureDiagnostic) {
      const index = activePath.getStore();
      if (index === undefined || !failures[index]) { unattributed++; return; }
      const key = `${event.status}:${event.stage}:${event.code}`;
      const prior = failures[index]!.get(key);
      if (prior) prior.count++; else failures[index]!.set(key, { ...event, count: 1 });
    },
    // Fastify inject returns a lazy thenable. Start/await it inside the async context.
    run<T>(index: number, work: () => PromiseLike<T>): Promise<T> { return activePath.run(index, async () => await work()); },
    reasons(index: number) { return [...failures[index]!.values()].sort((a,b)=>`${a.stage}:${a.code}:${a.status}`.localeCompare(`${b.stage}:${b.code}:${b.status}`)); },
    unattributedFailures: () => unattributed,
  };
}

export async function benchScale(config: Config, scenario: Scenario, concurrency: number, requests: number, warm: boolean, diagnostics = false) {
  if (!config.externalScale || !Object.hasOwn(scenarios, scenario) || ![20,50,100].includes(concurrency) ||
      !Number.isInteger(requests) || requests < concurrency || requests > 10_000) throw new Error('Invalid isolated benchmark parameters');
  const paths = scenarios[scenario];
  const collector = capacityFailureCollector(paths.length);
  const runtime = await buildApp(config, diagnostics ? { onPublicFailure: collector.observe } : {});
  try {
    if (warm) for (const url of paths) if ((await runtime.app.inject({ method:'GET',url })).statusCode !== 200) throw new Error('Warmup failed');
    const all = measurements();
    const byPath = paths.map(() => measurements());
    let next = 0;
    const start = performance.now();
    await Promise.all(Array.from({length:concurrency}, async () => {
      while (next < requests) {
        const n = next++;
        const at = performance.now();
        // Benchmark IPs exist only on app.inject's socket. The HTTP/proxy configuration is unchanged.
        const remoteAddress = `198.18.${Math.floor(n / 250)}.${n % 250 + 1}`;
        const index = n % paths.length;
        const request = { method:'GET' as const,url:paths[index]!,remoteAddress };
        const reply = await (diagnostics ? collector.run(index, () => runtime.app.inject(request)) : runtime.app.inject(request));
        const latency = performance.now() - at;
        record(all,reply.statusCode,latency);
        record(byPath[index]!,reply.statusCode,latency);
      }
    }));
    const elapsedMs = performance.now() - start;
    const status = await runtime.app.inject({url:'/health/catalog-cache'});
    return {fixture:'scale-v1',transport:'in-process',scenario,warm,concurrency,...report(all),
      routes:paths.map((path,index)=>({path,...report(byPath[index]!),...(diagnostics ? {
        failReasons:collector.reasons(index),
      } : {})})),
      elapsedMs:Math.round(elapsedMs),requestsPerSecond:Math.round(1000*requests/elapsedMs),
      cache:status.json(),...(diagnostics ? {diagnostics:{pool:runtime.db.capacityMetrics(),unattributedFailures:collector.unattributedFailures(),
        poolScope:'runtime-including-startup-warmup-and-final-health',
        acquisitionElapsedIncludesConnectionSetup:true,acquireElapsedHistogramCumulative:false}} : {})};
  } finally { await runtime.app.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [scenario, concurrency, requests, ...flags] = process.argv.slice(2);
    if (!scenario || !concurrency || !requests || flags.some(flag => !['--warm','--diagnostics'].includes(flag)) || new Set(flags).size !== flags.length) throw new Error();
    console.log(JSON.stringify(await benchScale(readConfig(), scenario as Scenario, Number(concurrency), Number(requests), flags.includes('--warm'), flags.includes('--diagnostics'))));
  } catch { console.error('Isolated catalog benchmark failed.'); process.exitCode=1; }
}
