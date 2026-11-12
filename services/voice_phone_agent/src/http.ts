import { Agent, ProxyAgent, fetch, type RequestInit } from 'undici';
import { cfg } from './config.js';

// Two separate connection pools, chosen per call site (never by env), so that
// LiveKit/Smart Judge traffic can never leak into the proxy and foreign APIs never go direct.
const direct = new Agent({ keepAliveTimeout: 30_000, connect: { timeout: 10_000 } });
const proxied = cfg.proxyUrl ? new ProxyAgent({ uri: cfg.proxyUrl, keepAliveTimeout: 30_000 }) : direct;

/** Domestic endpoints: Smart Judge, local TTS sidecar. */
export const fetchDirect = (url: string, init: RequestInit = {}) => fetch(url, { ...init, dispatcher: direct });
/** Sanctioned foreign APIs: Groq, OpenAI. */
export const fetchProxied = (url: string, init: RequestInit = {}) => fetch(url, { ...init, dispatcher: proxied });

export async function closeHttp() {
  await Promise.allSettled([direct.close(), proxied.close()]);
}
