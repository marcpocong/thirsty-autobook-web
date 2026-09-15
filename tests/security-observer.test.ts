import {afterEach,expect,it,vi} from 'vitest';
import type {Page} from 'playwright';
import {installSelectionSecuritySentinel,readSelectionSecuritySentinel,selectionPort} from '../src/selection.js';
import {Safety} from '../src/safety.js';
import {ONDA_URL} from '../src/config.js';

let callback:()=>void=()=>{},disconnected=0,observed:unknown;
class Observer {constructor(cb:()=>void){callback=cb;}observe(target:unknown){observed=target;}disconnect(){disconnected++;}}
function fixture(text='Schedule'){const body={innerText:text};Object.assign(globalThis,{window:globalThis,document:{body,documentElement:{},visibilityState:'visible',querySelectorAll:()=>[{}]},MutationObserver:Observer});return body;}
afterEach(()=>{delete (globalThis as {__thirstyGuard?:unknown}).__thirstyGuard;delete (globalThis as {window?:unknown}).window;delete (globalThis as {document?:unknown}).document;delete (globalThis as {MutationObserver?:unknown}).MutationObserver;callback=()=>{};disconnected=0;observed=undefined;});
it('ignores harmless slot changes and burst mutations',()=>{const body=fixture();installSelectionSecuritySentinel();for(let i=0;i<100;i++){body.innerText=`Court ${i%7+1} selected`;callback();}expect(readSelectionSecuritySentinel().reason).toBeUndefined();});
it.each([['challenge node','Verify that you are human','SECURITY_CHALLENGE'],['characterData','captcha','SECURITY_CHALLENGE'],['rate limit','Too many requests. Retry after 10 seconds','RATE_LIMITED'],['subtree','Access denied: security challenge','SECURITY_CHALLENGE']] as const)('detects %s synchronously before the next light guard',(_kind,text,reason)=>{const body=fixture();installSelectionSecuritySentinel();body.innerText=text;callback();expect(readSelectionSecuritySentinel().reason).toBe(reason);});
it('detects wholesale body replacement because the stable document root is observed',()=>{fixture();const root=(globalThis as unknown as {document:{documentElement:unknown;body:{innerText:string}}}).document.documentElement;installSelectionSecuritySentinel();expect(observed).toBe(root);(globalThis as unknown as {document:{body:{innerText:string}}}).document.body={innerText:'429'};callback();expect(readSelectionSecuritySentinel().reason).toBe('RATE_LIMITED');});
it('the next light guard aborts before another booking action after detection',async()=>{const body=fixture();installSelectionSecuritySentinel();body.innerText='Checking your browser';callback();const safety=new Safety(),page={evaluate:async(fn:()=>unknown)=>fn(),url:()=>ONDA_URL} as unknown as Page;await expect(selectionPort(page,safety).lightGuard!()).rejects.toThrow('SECURITY_CHALLENGE');});
it('disconnects the old observer and reinstalls a clean sentinel at every full guard',()=>{fixture();installSelectionSecuritySentinel();installSelectionSecuritySentinel();expect(disconnected).toBe(1);expect(readSelectionSecuritySentinel()).toMatchObject({installed:true,visible:true,grid:1});});
