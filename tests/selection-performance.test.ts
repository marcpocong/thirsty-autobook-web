import {DateTime} from 'luxon';
import {expect,it} from 'vitest';
import {selectCheckoutBundle} from '../src/checkout-selection.js';
import {Safety} from '../src/safety.js';
import {Telemetry} from '../src/telemetry.js';
import type {Snapshot} from '../src/grid.js';
import type {SelectionPort} from '../src/selection.js';

const date='2026-09-18';
function fixture():Snapshot{
  const g:Snapshot={heading:DateTime.fromISO(date).setLocale('en').toFormat('ccc, LLLL d'),busy:false,rows:[],cells:[]};
  const clock=(h:number)=>`${h%12||12} ${h%24<12?'AM':'PM'}`;
  for(let h=8;h<24;h++){const hour=`${String(h).padStart(2,'0')}:00`;g.rows.push({date,hour});for(let court=1;court<=7;court++)g.cells.push({date,hour,label:`Court ${court}: Mango Wing ${clock(h)} to ${clock(h+1)} available`,state:'available',disabled:false});}
  return g;
}
function run(count:1|2,duration:1|2|3){
  const grid=fixture(),safety=new Safety(),telemetry=new Telemetry();let reads=0,fullGuards=0,lightGuards=0;
  const hours=Array.from({length:duration},(_,i)=>`${18+i}:00`),courts=count===1?[7]:[7,6];
  const port:SelectionPort={guard:async()=>{fullGuards++;safety.check();},lightGuard:async()=>{lightGuards++;safety.check();},read:async()=>{reads++;return structuredClone(grid);},click:async(_date,court,hour)=>{const cell=grid.cells.find(c=>c.hour===hour&&c.label.startsWith(`Court ${court}:`))!;cell.state='selected';cell.label=cell.label.replace(/available$/,'selected');},summary:async()=>({count:`${count} Court${count===1?'':'s'} \u2022 ${count*duration} Slots`,amount:`PHP ${count*1000}`,actionable:true})};
  const result=selectCheckoutBundle(port,date,grid,{browser:'A',start:'18:00',duration,hours,requiredCourtCount:count,courts},1000,safety,new Set(),telemetry);
  return {result,stats:()=>({reads,fullGuards,lightGuards}),telemetry};
}

it.each([[1,1],[1,2],[1,3],[2,1],[2,2],[2,3]] as const)('%i court x %ih successful checkout uses one final full-grid read',async(count,duration)=>{
  const h=run(count,duration);await h.result;
  expect(h.stats()).toEqual({reads:1,fullGuards:2,lightGuards:count*duration});
  expect(count*duration+1).toBeGreaterThan(h.stats().reads);
  expect(h.telemetry.events.filter(e=>e.event.endsWith('StateConfirmed'))).toHaveLength(count*duration);
  expect(h.telemetry.events.filter(e=>e.event==='selectionFinalVerificationCompleted')).toHaveLength(1);
  expect(h.telemetry.events.filter(e=>e.event==='selectionFullGridRead')).toHaveLength(1);
  expect(h.telemetry.events.filter(e=>e.event==='fullGuardCompleted')).toHaveLength(2);
  expect(h.telemetry.events.filter(e=>e.event==='lightGuardCompleted')).toHaveLength(count*duration);
});

it('a mid-bundle conflict performs an authoritative read and never locks',async()=>{
  const grid=fixture(),safety=new Safety();let reads=0,clicks=0;
  const port:SelectionPort={guard:async()=>{},lightGuard:async()=>{},read:async()=>{reads++;return structuredClone(grid);},click:async()=>{if(++clicks===2)throw Error('detached');},summary:async()=>({count:'',amount:'',actionable:false})};
  await expect(selectCheckoutBundle(port,date,grid,{browser:'A',start:'18:00',duration:3,hours:['18:00','19:00','20:00'],requiredCourtCount:1,courts:[7]},1000,safety,new Set())).rejects.toThrow('SELECTION_CONFLICT');
  expect(reads).toBe(1);expect(safety.locked).toBe(false);
});
