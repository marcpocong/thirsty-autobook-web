import {expect,it,vi} from 'vitest';
import type {Page} from 'playwright';
import {showWorkerPage,focusResultFromCode} from '../src/browser-window.js';

it('reports focus only for the window that actually holds the foreground',()=>{
  expect(focusResultFromCode('WINDOW_FOCUSED\r\n')).toBe('focused');
  for(const code of ['WINDOW_RAISED','WINDOW_NOT_FOUND','WINDOW_AMBIGUOUS','']) expect(focusResultFromCode(code)).toBe('unconfirmed');
});

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

it('restores a minimized window to normal before maximizing it',async()=>{
  const send=vi.fn(async(method:string)=>method==='Browser.getWindowForTarget'?{windowId:21,bounds:{windowState:'minimized'}}:{});
  const detach=vi.fn(async()=>{}),bringToFront=vi.fn(async()=>{});
  const page={evaluate:vi.fn(async()=>{}),bringToFront,context:()=>({newCDPSession:async()=>({send,detach})})} as unknown as Page;

  await showWorkerPage(page,'B',{maximize:true});

  // Chrome refuses minimized -> maximized directly, so 'normal' has to come first.
  expect(send.mock.calls).toEqual([
    ['Browser.getWindowForTarget'],
    ['Browser.setWindowBounds',{windowId:21,bounds:{windowState:'normal'}}],
    ['Browser.setWindowBounds',{windowId:21,bounds:{windowState:'maximized'}}],
  ]);
  expect(bringToFront).toHaveBeenCalledOnce();
});

it('still surfaces the tab when window bounds cannot be changed',async()=>{
  const send=vi.fn(async(method:string)=>{
    if(method==='Browser.getWindowForTarget')return {windowId:22,bounds:{windowState:'minimized'}};
    throw Error('Protocol error (Browser.setWindowBounds)');
  });
  const bringToFront=vi.fn(async()=>{}),detach=vi.fn(async()=>{});
  const page={evaluate:vi.fn(async()=>{}),bringToFront,context:()=>({newCDPSession:async()=>({send,detach})})} as unknown as Page;

  await expect(showWorkerPage(page,'C',{maximize:true})).resolves.toBeUndefined();

  expect(bringToFront).toHaveBeenCalledOnce();
  expect(detach).toHaveBeenCalledOnce();
});

it('does not maximize routine automatic browser presentation',async()=>{
  const send=vi.fn(async(method:string)=>method==='Browser.getWindowForTarget'?{windowId:18,bounds:{windowState:'normal'}}:{});
  const page={evaluate:vi.fn(async()=>{}),bringToFront:vi.fn(async()=>{}),context:()=>({newCDPSession:async()=>({send,detach:vi.fn(async()=>{})})})} as unknown as Page;

  await showWorkerPage(page,'A');

  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith('Browser.getWindowForTarget');
});
