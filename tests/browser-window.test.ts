import {expect,it,vi} from 'vitest';
import type {Page} from 'playwright';
import {showWorkerPage} from '../src/browser-window.js';

it('maximizes the exact worker window before bringing its tab to the front',async()=>{
  const send=vi.fn(async(method:string)=>method==='Browser.getWindowForTarget'?{windowId:17,bounds:{windowState:'normal'}}:{});
  const detach=vi.fn(async()=>{}),bringToFront=vi.fn(async()=>{}),evaluate=vi.fn(async()=>{});
  const page={evaluate,bringToFront,context:()=>({newCDPSession:async()=>({send,detach})})} as unknown as Page;

  await showWorkerPage(page,'D',{maximize:true});

  expect(evaluate).toHaveBeenCalledOnce();
  expect(send.mock.calls).toEqual([
    ['Browser.getWindowForTarget'],
    ['Browser.setWindowBounds',{windowId:17,bounds:{windowState:'maximized'}}],
  ]);
  expect(detach).toHaveBeenCalledOnce();
  expect(bringToFront).toHaveBeenCalledOnce();
});

it('does not maximize routine automatic browser presentation',async()=>{
  const send=vi.fn(async(method:string)=>method==='Browser.getWindowForTarget'?{windowId:18,bounds:{windowState:'normal'}}:{});
  const page={evaluate:vi.fn(async()=>{}),bringToFront:vi.fn(async()=>{}),context:()=>({newCDPSession:async()=>({send,detach:vi.fn(async()=>{})})})} as unknown as Page;

  await showWorkerPage(page,'A');

  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith('Browser.getWindowForTarget');
});
