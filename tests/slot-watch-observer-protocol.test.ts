import {describe,expect,it} from 'vitest';
import {isObserverEvent,SLOT_WATCH_OBSERVER_PROTOCOL} from '../src/slot-watch-observer-protocol.js';
describe('slot watch observer protocol',()=>{
  it('accepts a sanitized start signal and rejects malformed events',()=>{
    expect(isObserverEvent({protocol:SLOT_WATCH_OBSERVER_PROTOCOL,type:'started',id:'x',seq:1})).toBe(true);
    expect(isObserverEvent({protocol:SLOT_WATCH_OBSERVER_PROTOCOL,type:'view',id:'x',seq:2,view:{}})).toBe(false);
    expect(isObserverEvent({protocol:SLOT_WATCH_OBSERVER_PROTOCOL,type:'failed',id:'x',seq:3,code:'raw secret here'})).toBe(false);
  });
});
