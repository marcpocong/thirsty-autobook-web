import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Telemetry } from '../src/telemetry.js';
import { observePassiveReleaseNetwork, passiveEndpoint } from '../src/passive-release-network.js';
import { observePreferredCells } from '../src/passive-target-cells.js';

describe('passive release network telemetry',()=>{
  const base='https://app.onda.fit';
  it('allowlists only exact paths, origin and method',()=>{
    expect(passiveEndpoint(`${base}/api/bookings/public-checkout?opaque=placeholder`,'POST')).toBe('RESERVATION_SUBMISSION');
    expect(passiveEndpoint(`${base}/api/bookings/public-checkout/other`,'POST')).toBeUndefined();
    expect(passiveEndpoint('https://other.example/api/bookings/public-checkout','POST')).toBeUndefined();
    expect(passiveEndpoint(`${base}/api/bookings/public-checkout`,'GET')).toBeUndefined();
  });
  it('orders phases, strips URL/body and retains a navigation cancellation',()=>{
    const page=new EventEmitter(),t=new Telemetry();
    const cleanup=observePassiveReleaseNetwork(page as never,t.worker('A'));
    const request={url:()=>`${base}/api/bookings/public-checkout?opaque=placeholder`,method:()=> 'POST',failure:()=>({errorText:'net::ERR_ABORTED'})};
    page.emit('request',request);
    page.emit('request',request);
    page.emit('response',{request:()=>request,status:()=>202});
    page.emit('response',{request:()=>request,status:()=>202});
    page.emit('requestfailed',request);
    const records=t.document().passiveNetwork!;
    expect(records.map(e=>e.phase)).toEqual(['DISPATCHED','HEADERS','FAILED']);
    expect(records[2]).toMatchObject({status:202,failure:'CANCELED_OR_NAVIGATED',workerId:'A'});
    expect(records.every(e=>!JSON.stringify(e).includes('placeholder'))).toBe(true);
    expect(records[0]!.monoMs).toBeLessThanOrEqual(records[1]!.monoMs);
    cleanup();
    expect(page.listenerCount('request')).toBe(0);
    page.emit('request',request);
    expect(t.document().passiveNetwork).toHaveLength(3);
  });
  it('keeps partial evidence and never throws from a broken diagnostic sink',()=>{
    const page=new EventEmitter(),t=new Telemetry();
    const cleanup=observePassiveReleaseNetwork(page as never,t);
    const request={url:()=>`${base}/api/bookings/public-checkout`,method:()=> 'POST'};
    page.emit('request',request);
    cleanup();
    expect(t.document().passiveNetwork?.map(e=>e.phase)).toEqual(['DISPATCHED','FAILED']);
    const broken=new EventEmitter();
    observePassiveReleaseNetwork(broken as never,{recordPassiveNetwork:vi.fn(()=>{throw Error('disk error');})} as never);
    expect(()=>broken.emit('request',request)).not.toThrow();
  });
  it('records a closed release context without customer data',()=>{
    const t=new Telemetry();t.recordReleaseContext('2026-09-19','browser');
    expect(t.document().releaseContext).toEqual({targetDate:'2026-09-19',bookingMethod:'browser'});
  });
});

it('preferred-cell observer emits fixed names once and cleans up without booking actions',async()=>{
  let binding:((_source:unknown,event:string)=>void)|undefined;
  const page={exposeBinding:vi.fn(async(_name:string,callback:typeof binding)=>{binding=callback;}),
    addInitScript:vi.fn(async()=>{}),evaluate:vi.fn(async()=>{})};
  const mark=vi.fn();
  const cleanup=await observePreferredCells(page as never,{mark} as never,{date:'2026-09-19',heading:'Sat, September 19',court:7,hours:['18:00','19:00']});
  binding?.({},'preferredCellsPresent');binding?.({},'preferredCellsPresent');
  binding?.({},'preferredCellsDomEligible');
  expect(mark.mock.calls.map(call=>call[0])).toEqual(['preferredCellsPresent','preferredCellsDomEligible']);
  expect(page.addInitScript).toHaveBeenCalledOnce();
  expect(page.evaluate).toHaveBeenCalledTimes(2);
  cleanup();binding?.({},'preferredCellsDomEligible');
  expect(mark).toHaveBeenCalledTimes(2);
  expect(page.evaluate).toHaveBeenCalledTimes(3);
});
