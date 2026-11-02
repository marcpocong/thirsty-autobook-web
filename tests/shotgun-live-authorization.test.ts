import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assertLiveRehearsalAuthorization, assertSingleShotLabQualification, rehearsalRequestFingerprint, REHEARSAL_MODULES } from '../src/shotgun-live-authorization.js';
const now=Date.parse('2026-11-02T02:00:00Z');
const request={kind:'SHOTGUN_LIVE_REHEARSAL',date:'2026-11-04',wing:'MANGO',court:1,worker:'A',start:'08:00',duration:1,maximum:600,attempts:1,payment:false};
const authorization=()=>({schema:'shotgun-live-authorization/v2',request:{...request},approvedBy:'OWNER_CONVERSATION',
  approvedAt:new Date(now).toISOString(),expiresAt:new Date(now+900_000).toISOString(),ownerDirectiveSha256:'d'.repeat(64),
  requestFingerprint:rehearsalRequestFingerprint(request),installedSha:'e'.repeat(40),
  engineHashes:Object.fromEntries(REHEARSAL_MODULES.map(name=>[name,'a'.repeat(64)])),
  attestation:'EXACT_TARGET_ONE_POST_NO_PAYMENT_NO_CANCELLATION_NO_RETRY'});
describe('auditable exact-target live test authorization',()=>{
  it('pins existing production modules including independent provider verification',()=>{
    for(const name of REHEARSAL_MODULES)expect(existsSync(new URL(`../src/${name.replace(/\.js$/,'.ts')}`,import.meta.url))||existsSync(new URL(`../src/${name}`,import.meta.url)),name).toBe(true);
    expect(assertLiveRehearsalAuthorization(authorization(),now).request.attempts).toBe(1);
  });
  it.each([0,900_000,900_001])('refuses authority outside its exact time window: %s',offset=>{
    const auth=authorization();if(offset===0)auth.approvedAt=new Date(now+1).toISOString();
    expect(()=>assertLiveRehearsalAuthorization(auth,now+offset)).toThrow('REHEARSAL_AUTHORIZATION_EXPIRED');
  });
  it('refuses a target changed after attestation',()=>{
    const auth=authorization();auth.request.court=2;
    expect(()=>assertLiveRehearsalAuthorization(auth,now)).toThrow('REHEARSAL_AUTHORIZATION_TARGET_CHANGED');
  });
  it('refuses missing verification pins and permits no invented attestation',()=>{
    const auth=authorization();delete auth.engineHashes['api-booking/provider-hold-verification.js'];
    expect(()=>assertLiveRehearsalAuthorization(auth,now)).toThrow('REHEARSAL_AUTHORIZATION_MODULES_INCOMPLETE');
    expect(()=>assertLiveRehearsalAuthorization({...authorization(),attestation:''},now)).toThrow();
  });
  it('requires same-engine single-shot live confirmation and both QR paths before increasing the budget',()=>{
    const auth=authorization(),multi={kind:'SHOTGUN_LIVE_LAB',requests:[request,{...request,worker:'B',court:2}],attempts:2,payment:false};
    expect(()=>assertLiveRehearsalAuthorization({...auth,request:multi,requestFingerprint:rehearsalRequestFingerprint(multi)},now)).toThrow('LAB_SINGLE_SHOT_QUALIFICATION_REQUIRED');
    const result={interaction:'LIVE_PROVIDER',authorizedAttempts:1,actualBookingPosts:1,installedSha:auth.installedSha,
      results:[{state:'QR_READY'}],workers:[{providerConfirmed:true,firstHandoff:true,recoveredInFreshTab:true}],engineHashes:auth.engineHashes};
    const prove=(value:unknown)=>{const bytes=Buffer.from(JSON.stringify(value));
      const authorized=assertLiveRehearsalAuthorization({...auth,singleShotQualification:{run:'prior-single',resultSha256:createHash('sha256').update(bytes).digest('hex')}},now);
      return ()=>assertSingleShotLabQualification(authorized,bytes);
    };
    expect(prove(result)).not.toThrow();
    expect(prove({...result,interaction:'OFFLINE_SIMULATION'})).toThrow('LAB_SINGLE_SHOT_QUALIFICATION_INVALID');
    expect(prove({...result,actualBookingPosts:0})).toThrow('LAB_SINGLE_SHOT_QUALIFICATION_INVALID');
    expect(prove({...result,workers:[{providerConfirmed:false,firstHandoff:true,recoveredInFreshTab:false}]})).toThrow('LAB_SINGLE_SHOT_QUALIFICATION_INVALID');
    expect(prove({...result,installedSha:'b'.repeat(40)})).toThrow('LAB_SINGLE_SHOT_QUALIFICATION_INVALID');
  });
});
