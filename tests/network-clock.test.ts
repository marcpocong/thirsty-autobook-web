import {describe,expect,it} from 'vitest';
import {calculateNtpOffset} from '../src/network-clock.js';

describe('network clock',()=>{
  it('calculates NTP offset and removes server processing time from round trip',()=>{
    // Local clock is 120 ms slow; network legs are 20/30 ms and server work is 5 ms.
    const t1=1_000,t2=1_140,t3=1_145,t4=1_055;
    expect(calculateNtpOffset(t1,t2,t3,t4)).toEqual({offsetMs:115,roundTripMs:50});
  });
});
