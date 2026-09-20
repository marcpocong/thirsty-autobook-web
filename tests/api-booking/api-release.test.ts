import { describe,expect,it } from 'vitest';
import { API_RELEASE_MAX_LATENESS_MS,assertApiReleaseFresh } from '../../src/api-booking/api-release.js';

describe('API release clock boundary',()=>{
  it('accepts only the immediate post-release window',()=>{
    const release=Date.parse('2026-09-21T08:00:00+08:00');
    expect(()=>assertApiReleaseFresh(release,release)).not.toThrow();
    expect(()=>assertApiReleaseFresh(release,release+API_RELEASE_MAX_LATENESS_MS)).not.toThrow();
  });
  it('fails closed before release or after a delayed wake',()=>{
    const release=Date.parse('2026-09-21T08:00:00+08:00');
    expect(()=>assertApiReleaseFresh(release,release-1)).toThrow('RELEASE_MISSED');
    expect(()=>assertApiReleaseFresh(release,release+API_RELEASE_MAX_LATENESS_MS+1)).toThrow('RELEASE_MISSED');
  });
});
