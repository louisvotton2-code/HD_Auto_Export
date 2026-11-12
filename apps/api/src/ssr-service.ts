import { createHash, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import type { Config } from './config.js';

export const SSR_CATALOG_PREFIX = '/internal/public-catalog';
export const SSR_CATALOG_VERSION_PATH = `${SSR_CATALOG_PREFIX}/version`;
/** Single API process: 30 requests/second, a bounded burst of 40, no waiting queue. */
export class SsrOriginLimiter {
  private tokens=40;
  private last:number;
  constructor(private now:()=>number=()=>performance.now()) {this.last=now();}
  take():boolean {
    const at=this.now();this.tokens=Math.min(40,this.tokens+Math.max(0,at-this.last)*30/1000);this.last=at;
    if(this.tokens<1)return false;
    this.tokens--;return true;
  }
}
export function createSsrServiceIdentity(config: Config['ssrService']) {
  const peers = new BlockList();
  for (const value of config?.peers ?? []) {
    const [address,bits] = value.split('/');
    const family = isIP(address!) === 4 ? 'ipv4' : 'ipv6';
    if (bits) peers.addSubnet(address!,Number(bits),family); else peers.addAddress(address!,family);
  }
  const digest = config ? createHash('sha256').update(config.secret).digest() : null;
  return (request: FastifyRequest): boolean => {
    const route=request.routeOptions.url ?? '', peer=request.raw.socket.remoteAddress;
    if (!digest || request.method !== 'GET' || !route.startsWith(`${SSR_CATALOG_PREFIX}/`) || !peer || !isIP(peer) ||
        !peers.check(peer,isIP(peer)===4?'ipv4':'ipv6')) return false;
    const supplied=request.headers['x-hd-ssr-key'];
    if (typeof supplied !== 'string' || supplied.length < 32 || supplied.length > 256) return false;
    return timingSafeEqual(digest,createHash('sha256').update(supplied).digest());
  };
}
