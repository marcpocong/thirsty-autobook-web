import { chromium, type Page, type Browser } from 'playwright';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync,renameSync,writeFileSync,mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ONDA_URL, VENUE } from './config.js';
import { Safety, securityReason } from './safety.js';
import { classifyRateLimit } from './rate-limit.js';
import type { Telemetry } from './telemetry.js';
import { WORKER_IDS, type WorkerId } from './workers.js';

export const cdpCodes = ['CDP_WRONG_PORT', 'CDP_NOT_LISTENING', 'CDP_UNSAFE_BIND', 'CDP_AMBIGUOUS_LISTENER',
  'CDP_PROCESS_METADATA_UNAVAILABLE', 'CDP_PROCESS_NOT_CHROME', 'CDP_PROFILE_MISSING', 'CDP_WRONG_PROFILE'] as const;
export interface BrowserIdentity { workerId:WorkerId; cdpUrl: string; port: number; expectedProfile: string }
const endpointPath=()=>resolve('.local/browser-endpoints.json');
const apiInstallation=()=>process.env.THIRSTY_API_INSTALLATION==='1'||process.env.THIRSTY_API_TEST_INSTALLATION==='1';
const workerIndex=(workerId:WorkerId)=>WORKER_IDS.indexOf(workerId);
const defaultPort=(workerId:WorkerId)=>(apiInstallation()?19444:9222)+workerIndex(workerId);
const profile=(workerId:WorkerId)=>`${apiInstallation()?'.local/api-first-chrome-profile':'.local/onda-chrome-profile'}${workerId==='A'?'':`-${workerId.toLowerCase()}`}`;
function storedPorts():Partial<Record<WorkerId,number>>{
  try{
    const parsed=JSON.parse(readFileSync(endpointPath(),'utf8')) as Record<string,unknown>;
    if(parsed.version!==1)return {};
    const valid=(value:unknown)=>Number.isInteger(value)&&Number(value)>=1024&&Number(value)<=65535;
    const result:Partial<Record<WorkerId,number>>={};
    for(const id of WORKER_IDS)if(valid(parsed[id]))result[id]=Number(parsed[id]);
    return new Set(Object.values(result)).size===Object.values(result).length?result:{};
  }catch{return {};}
}
export function browserIdentity(workerId:WorkerId):BrowserIdentity{
  const port=storedPorts()[workerId]??defaultPort(workerId);
  return Object.freeze({workerId,cdpUrl:`http://127.0.0.1:${port}`,port,expectedProfile:profile(workerId)});
}
export function candidateBrowserIdentity(workerId:WorkerId,port:number):BrowserIdentity{
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('CDP_IDENTITY_MISMATCH');
  return Object.freeze({workerId,cdpUrl:`http://127.0.0.1:${port}`,port,expectedProfile:profile(workerId)});
}
export let browserA:BrowserIdentity=browserIdentity('A');
export let browserB:BrowserIdentity=browserIdentity('B');
export let browserC:BrowserIdentity=browserIdentity('C');
export let browserD:BrowserIdentity=browserIdentity('D');
export function rememberBrowserPort(workerId:WorkerId,port:number){
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('CDP_IDENTITY_MISMATCH');
  const current=storedPorts();
  if(WORKER_IDS.some(id=>id!==workerId&&port===(current[id]??defaultPort(id))))throw Error('CDP_IDENTITY_MISMATCH');
  const next={version:1,...Object.fromEntries(WORKER_IDS.map(id=>[id,id===workerId?port:current[id]??defaultPort(id)]))};
  const path=endpointPath(),temporary=`${path}.${process.pid}.tmp`;mkdirSync(dirname(path),{recursive:true});writeFileSync(temporary,JSON.stringify(next));renameSync(temporary,path);
  browserA=browserIdentity('A');browserB=browserIdentity('B');browserC=browserIdentity('C');browserD=browserIdentity('D');
  return browserIdentity(workerId);
}
export function validateBrowserIdentity(identity: BrowserIdentity) {
  const expected=browserIdentity(identity.workerId);
  if(identity.port !== expected.port || identity.cdpUrl !== expected.cdpUrl || resolve(identity.expectedProfile).toLowerCase() !== resolve(expected.expectedProfile).toLowerCase()) throw Error('CDP_IDENTITY_MISMATCH');
}
function verifyChromeProcess(identity:BrowserIdentity){
  if (process.platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  let code: string;
  try {
    code = execFileSync('powershell.exe', ['-NoProfile', '-File', resolve('scripts/verify-onda-chrome.ps1'),
      '-Port', String(identity.port), '-ExpectedProfile', resolve(identity.expectedProfile)],
      { encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { throw new Error('CDP_PROCESS_METADATA_UNAVAILABLE'); }
  if (code !== 'CDP_VERIFIED') throw new Error(cdpCodes.find(c => c === code) ?? 'CDP_PROCESS_METADATA_UNAVAILABLE');
}
export function verifyDedicatedChrome(identity: BrowserIdentity = browserA) {validateBrowserIdentity(identity);verifyChromeProcess(identity);}
/** Same process/profile checks without blocking independent browser workers on PowerShell startup. */
export async function verifyDedicatedChromeAsync(identity:BrowserIdentity = browserA):Promise<void>{
  validateBrowserIdentity(identity);
  if(process.platform!=='win32')throw Error('WINDOWS_REQUIRED');
  let code:string;
  try{
    const result=await promisify(execFile)('powershell.exe',['-NoProfile','-File',resolve('scripts/verify-onda-chrome.ps1'),
      '-Port',String(identity.port),'-ExpectedProfile',resolve(identity.expectedProfile)],
    {encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:4096});
    code=result.stdout.trim();
  }catch{throw Error('CDP_PROCESS_METADATA_UNAVAILABLE');}
  if(code!=='CDP_VERIFIED')throw Error(cdpCodes.find(value=>value===code)??'CDP_PROCESS_METADATA_UNAVAILABLE');
}
/** The closed code start-onda-chrome.ps1 printed (or failed with), read from a rejected execFile; never its raw text. */
export function starterFailureCode(error:unknown):string|undefined{
  const e=error as {message?:unknown;stdout?:unknown;stderr?:unknown};
  const text=[e?.message,e?.stdout,e?.stderr].filter(v=>typeof v==='string').join('\n');
  return [...cdpCodes,'CHROME_NOT_INSTALLED','CHROME_START_TIMEOUT'].find(code=>new RegExp(`(?:^|[^A-Z_])${code}(?:$|[^A-Z_])`).test(text));
}
export function verifyCandidateChrome(identity:BrowserIdentity){
  const expected=candidateBrowserIdentity(identity.workerId,identity.port);
  if(identity.cdpUrl!==expected.cdpUrl||resolve(identity.expectedProfile).toLowerCase()!==resolve(expected.expectedProfile).toLowerCase())throw Error('CDP_IDENTITY_MISMATCH');
  if(WORKER_IDS.some(id=>id!==identity.workerId&&identity.port===browserIdentity(id).port))throw Error('CDP_IDENTITY_MISMATCH');
  verifyChromeProcess(identity);
}
export async function attach(safety: Safety, telemetry?: Telemetry, identity: BrowserIdentity = browserA) {
  safety.check(); verifyDedicatedChrome(identity);
  const browser = await chromium.connectOverCDP(identity.cdpUrl, { timeout: 10000 }).catch(() => { throw Error('CDP_ENDPOINT_UNAVAILABLE'); });
  const candidates = browser.contexts().flatMap(c => c.pages()).filter(p => p.url() === ONDA_URL);
  if (candidates.length !== 1) throw new Error('ONDA_TAB_AMBIGUOUS_OR_MISSING');
  const page = candidates[0]!;
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(15000);
  monitorConnection(browser, page, safety, telemetry);
  await assertPage(page, safety);
  return { browser, page };
}
export function monitorConnection(browser: Browser, page: Page, safety: Safety, telemetry?: Telemetry) {
  browser.on('disconnected', () => safety.stop('CHROME_DISCONNECTED'));
  page.on('close', () => safety.stop('CHROME_DISCONNECTED'));
  page.on('crash', () => safety.stop('CHROME_DISCONNECTED'));
  page.on('response', response => {
    const rateLimit = classifyRateLimit(response);
    if (rateLimit) {
      const { evidence, restricted } = rateLimit;
      telemetry?.rateLimit(evidence.sameOndaSite ? restricted ? 'ondaRateLimited' : 'ondaRetryAfterUnrestricted' : 'thirdPartyRateLimited', evidence);
      if (evidence.sameOndaSite && restricted) safety.stop('RATE_LIMITED', evidence);
    }
    if ([401, 403].includes(response.status()) && response.request().isNavigationRequest()) safety.stop('ACCESS_BLOCKED');
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && !safety.boundary && frame.url() !== ONDA_URL) safety.stop('UNEXPECTED_REDIRECT');
  });
}
export async function assertPage(page: Page, safety: Safety) {
  safety.check();
  if (page.url() !== ONDA_URL) throw new Error('WRONG_URL');
  const reason = securityReason(await page.locator('body').innerText());
  if (reason) { safety.stop(reason); safety.check(); }
  if ((await page.getByTestId('public-booking-hero-title').innerText()).trim() !== VENUE) throw new Error('WRONG_VENUE');
  if (await page.getByTestId('booking-selected-date-label').count() !== 1 || await page.getByTestId('booking-grid-body').count() !== 1) throw new Error('GRID_UNVERIFIED');
  safety.check();
}
