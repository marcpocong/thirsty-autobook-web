import {describe,it,expect} from 'vitest';
import {readDispatcherMachineKey} from '../ui/runner-runtime.js';
import {shotgunMachineKey} from '../src/shotgun-timing.js';

describe('actual dispatcher runtime provenance',()=>{
  it('measures the real executable rather than relabeling a saved timing profile',()=>{
    const key=readDispatcherMachineKey(process.execPath);
    expect(key).toBe(shotgunMachineKey());
    expect(JSON.parse(key!).node).toBe(process.version);
  });
  it('refuses applicability when the dispatcher executable cannot be measured',()=>{
    expect(readDispatcherMachineKey('missing-thirsty-fixture-executable')).toBeNull();
  });
});
