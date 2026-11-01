import {el,fill,onPane,onRender,manilaTime,peso,hooks} from './navigation.js';
import type {PendingHoldRow} from '../../src/api-booking/pending-hold-service.js';
let rows:PendingHoldRow[]=[],busy=false,message='';
async function refresh(){
  if(busy)return;busy=true;render();
  try{const result=await window.thirsty.pendingHolds({action:'list'});rows=result.rows??rows;message=result.error??'';}
  catch{message='PENDING_HOLD_LIST_UNAVAILABLE';}finally{busy=false;render();}
}
async function recover(id:string,mode:'original'|'fresh'){
  if(busy)return;busy=true;message='Verifying the existing reservation with Onda…';render();
  try{const result=await window.thirsty.pendingHolds({action:'recover',id,mode});rows=result.rows??rows;
    message=result.error??result.outcome?.code??'RECOVERY_OUTCOME_UNAVAILABLE';}
  catch{message='PENDING_HOLD_RECOVERY_FAILED';}finally{busy=false;render();}
}
function render(){
  const host=document.getElementById('pending-holds-panel');if(!host)return;
  const disabled=busy||hooks.labRunning||!!hooks.latest()&&hooks.latest()!.operation!=='idle';
  const button=el('button',{type:'button',class:'secondary',text:'Refresh saved holds'});button.disabled=disabled;button.onclick=()=>void refresh();
  fill(host,el('div',{class:'section-title'},el('h2',{text:'Pending Holds & Recovery'}),button),
    el('p',{class:'small',text:'Local response validation and Onda confirmation are separate. Recovery opens only the saved reservation; payment stays manual. UNKNOWN submission history and locks remain protected.'}),
    message?el('p',{class:'notice',role:'status',text:message}):null,
    ...rows.map(row=>{
      const action=el('button',{type:'button',class:'secondary',text:'Recover Existing Checkout'});action.disabled=disabled||!row.worker;action.onclick=()=>void recover(row.id,'fresh');
      const original=el('button',{type:'button',class:'secondary compact',text:'Recover in original tab'});original.disabled=disabled||!row.worker;original.onclick=()=>void recover(row.id,'original');
      return el('article',{class:'pending-recovery-row','data-recovery-id':row.id},
        el('h3',{text:`Browser ${row.worker??'?'} · ${row.wing} Court ${row.courts.join(' + ')||'?'}`}),
        el('p',{text:`${row.date} · ${row.start}–${row.end} · ${row.amount===null?'Amount unknown':peso(row.amount)}`}),
        el('p',{class:'small',text:`Advertised expiry: ${row.advertisedExpiry?manilaTime(Date.parse(row.advertisedExpiry)):'unknown'} · ${row.outstanding?'Outstanding / unresolved':'Provider terminal evidence recorded'}`}),
        el('p',{class:'small',text:`Local: ${row.local} · Provider: ${row.provider} · QR: ${row.qr}`}),
        el('p',{class:'small',text:`${row.freshConfirmationRequired?'Fresh provider confirmation required. ':''}${row.diagnostic}${row.contradiction?' · UNRESOLVED PROVIDER CONTRADICTION':''}`}),
        row.lastCheckedAt?el('p',{class:'small muted',text:`Latest recorded evidence: ${manilaTime(Date.parse(row.lastCheckedAt))}`}):null,
        el('div',{class:'button-row'},action,original));
    }),!rows.length?el('p',{class:'small',text:'No saved recovery responses found. This does not establish the absence of provider reservations.'}):null);
}
export function initPendingHolds(){
  let timer:ReturnType<typeof setInterval>|undefined,lastOperation='';
  onPane(pane=>{if(timer)clearInterval(timer);timer=undefined;if(pane==='records'){
    void refresh();timer=setInterval(()=>{if(!busy&&hooks.latest()?.operation==='idle')void refresh();},10_000);
  }});
  onRender(state=>{if(state.operation!==lastOperation){lastOperation=state.operation;render();}});render();
}
