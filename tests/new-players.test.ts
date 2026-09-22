import {describe,expect,it} from 'vitest';
import {ConfigSchema,playerForWorker,playerReadiness} from '../src/config.js';
import {contactBinding} from '../src/api-booking/local-customer.js';

const identities=Object.fromEntries('ABCDEFGH'.split('').flatMap((worker,index)=>{
  const prefix=worker==='A'?'PLAYER':`PLAYER_${worker}`;
  return [[`${prefix}_FULL_NAME`,`Fixture ${worker}`],[`${prefix}_PHONE`,`+6391000000${String(index).padStart(2,'0')}`],
    [`${prefix}_EMAIL`,`${worker.toLowerCase()}@example.invalid`]];
}));
const config=()=>ConfigSchema.parse({...identities,BOOKING_METHOD:'api-first',BOOKING_TYPE:'extended',COURT_COUNT:7,
  START_TIME:'17:00',DURATION_HOURS:4,PREFERRED_COURTS:[7,6,5,4,3,2,1],FALLBACK_TIMES:[]});

describe('Players E through H',()=>{
  it('loads eight distinct verified-format local identities',()=>{
    const value=config();
    expect('ABCDEFGH'.split('').map(worker=>playerForWorker(value,worker as 'A'|'B'|'C'|'D'|'E'|'F'|'G'|'H').email))
      .toEqual('abcdefgh'.split('').map(letter=>`${letter}@example.invalid`));
    expect(Object.values(playerReadiness(value)).every(Boolean)).toBe(true);
  });
  it('rejects a duplicate contact and changes the private binding when contact data changes',()=>{
    const value=config();
    const duplicate={...value,PLAYER_G_PHONE:value.PLAYER_E_PHONE};
    expect(()=>playerForWorker(duplicate,'G')).toThrow('PLAYER_G_INFO_MISSING');
    const e=playerForWorker(value,'E');
    expect(contactBinding(e.fullName,e.phone,e.email)).not.toBe(contactBinding(e.fullName,e.phone,'changed@example.invalid'));
  });
});
