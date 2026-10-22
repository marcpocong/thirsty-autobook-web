import { readFile } from 'node:fs/promises';
import type { Page } from 'playwright';
import { OndaLiveAvailabilityProvider, LiveAvailabilityError, THIRSTY_PICKLE_FACILITY_ID, type LiveAvailabilityOptions } from './live-availability-provider.js';

const ORIGIN = 'https://app.onda.fit';
const PATH = `/api/public/facilities/${THIRSTY_PICKLE_FACILITY_ID}/date-availability`;
const MAX_BYTES = 4_000_000;

/** Normal same-origin GET in the operator's verified browser. No copied cookies,
 * credentials, security headers, proof replay, navigation or checkout fallback.
 * The parent retains the exact parser, pricing and freshness checks.
 */
export class OndaBrowserAvailabilityProvider extends OndaLiveAvailabilityProvider {
  constructor(page: Pick<Page, 'url' | 'evaluate'>, options: Omit<LiveAvailabilityOptions, 'fetcher'> & {onHeaders?:(headers:Headers)=>void} = {}) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      let pageUrl: URL;
      try { pageUrl = new URL(page.url()); } catch { throw new LiveAvailabilityError('AVAILABILITY_BROWSER_ORIGIN_INVALID',undefined,false); }
      if (pageUrl.origin !== ORIGIN || url.origin !== ORIGIN || url.pathname !== PATH ||
          init?.method !== 'GET' || url.username || url.password)
        throw new LiveAvailabilityError('AVAILABILITY_BROWSER_SCOPE_INVALID',undefined,false);
      // The genuine public fingerprint is obtained and used entirely inside this
      // same page. No captured header, checkout challenge or worker credentials.
      const source=await readFile(new URL('./browser-availability-fetch.js',import.meta.url),'utf8');
      const result=await page.evaluate<{status:number;contentType:string;body:string;metadata?:Record<string,string>;failure?:string;requestSent?:boolean}>(
        `(${source})(${JSON.stringify({path:url.pathname+url.search,timeoutMs,maximum:MAX_BYTES})})`);
      if(result.failure)throw new LiveAvailabilityError(result.failure,undefined,result.requestSent===true);
      const response=new Response(result.body, { status: result.status, headers: { 'content-type': result.contentType, ...(result.metadata??{}) } });
      options.onHeaders?.(response.headers);return response;
    };
    super({ ...options, fetcher });
  }
}
