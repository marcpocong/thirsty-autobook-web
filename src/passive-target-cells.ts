import type { Page } from 'playwright';
import type { Telemetry } from './telemetry.js';

// The browser observer sends only two fixed marker names. Node stamps receipt on its own clock.
export async function observePreferredCells(page:Page,t:Pick<Telemetry,'mark'>,target:{date:string;heading:string;court:number;hours:string[]}){
  if(!Number.isInteger(target.court)||target.court<1||target.court>7||target.hours.length<1||target.hours.length>3||
    !target.hours.every(h=>/^(0[8-9]|1\d|2[0-3]):00$/.test(h)))return ()=>{};
  let active=true;
  const seen=new Set<string>();
  const binding='__thirstyPassivePreferredCellMark';
  await page.exposeBinding(binding,(_source,event:unknown)=>{
    try{if(active&&(event==='preferredCellsPresent'||event==='preferredCellsDomEligible')&&!seen.has(event)){seen.add(event);t.mark(event);}}catch{/* passive */}
  });
  const source=`(() => {
    if(sessionStorage.getItem('__thirstyPassivePreferredDisabled')==='1')return;
    const target=${JSON.stringify(target)};
    const old=window.__thirstyPreferredObserver;
    if(old)old.disconnect();
    let scheduled=false, scans=0, present=false, eligible=false;
    const scan=()=>{
      scheduled=false;
      if(document.querySelectorAll('[data-testid="booking-selected-date-label"]').length!==1||
        document.querySelector('[data-testid="booking-selected-date-label"]')?.textContent?.trim()!==target.heading)return;
      if(++scans>256){observer.disconnect();return;}
      let cells=[];
      for(const hour of target.hours){
        const rows=document.querySelectorAll('[data-schedule-grid-row-date="'+target.date+'"][data-schedule-grid-row-time="'+hour+'"]');
        if(rows.length!==1)return;
        const matches=[...rows[0].querySelectorAll('[data-testid="court-schedule-slot-cell"]')].filter(e=>e.getAttribute('aria-label')?.startsWith('Court '+target.court+':'));
        if(matches.length!==1)return;cells.push(matches[0]);
      }
      if(!present){present=true;window.${binding}('preferredCellsPresent');}
      if(!eligible&&!document.querySelector('[aria-busy="true"]')&&cells.every(e=>e.getAttribute('aria-label')?.endsWith(' available')&&
        e.querySelector('[data-slot-state]')?.getAttribute('data-slot-state')==='available'&&
        !e.disabled&&e.getAttribute('aria-disabled')!=='true'&&e.getClientRects().length>0)){
        eligible=true;window.${binding}('preferredCellsDomEligible');observer.disconnect();
      }
    };
    const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(scan);}};
    const observer=new MutationObserver(schedule);
    window.__thirstyPreferredObserver=observer;
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});schedule();
  })()`;
  await page.evaluate(`sessionStorage.removeItem('__thirstyPassivePreferredDisabled')`).catch(()=>{});
  await page.addInitScript({content:source});
  await page.evaluate(source).catch(()=>{});
  return ()=>{active=false;void page.evaluate(`window.__thirstyPreferredObserver?.disconnect();sessionStorage.setItem('__thirstyPassivePreferredDisabled','1')`).catch(()=>{});};
}
