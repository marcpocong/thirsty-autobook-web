import {chromium} from 'playwright';

const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage();
  await page.setContent(`<main id="root">${Array.from({length:112},(_,i)=>`<button data-slot="${i}">Court ${i%7+1} available</button>`).join('')}</main>`);
  const result=await page.evaluate(async()=>{
    const measure=async(name,mutate)=>{
      let scans=0,scanMs=0;
      const scan=()=>{const started=performance.now();void document.body.innerText;scanMs+=performance.now()-started;scans++;};
      const observer=new MutationObserver(scan);observer.observe(document.body,{subtree:true,childList:true,characterData:true});
      const started=performance.now();await mutate();await new Promise(resolve=>queueMicrotask(resolve));
      const wallMs=performance.now()-started;observer.disconnect();
      return {name,observerCallbacks:scans,securityScanMs:Math.round(scanMs*1000)/1000,wallMs:Math.round(wallMs*1000)/1000};
    };
    const slots=()=>[...document.querySelectorAll('[data-slot]')];
    const normal=await measure('six slot changes',async()=>{for(let i=0;i<6;i++)slots()[i].textContent='selected';});
    const rerenders=await measure('twenty rerenders',async()=>{for(let burst=0;burst<20;burst++){document.querySelector('#root').innerHTML=Array.from({length:112},(_,i)=>`<button data-slot="${i}">Court ${i%7+1} ${burst%2?'available':'selected'}</button>`).join('');await Promise.resolve();}});
    const burst=await measure('2240 burst mutations',async()=>{for(let n=0;n<20;n++)for(const [i,slot] of slots().entries())slot.textContent=`Court ${i%7+1} ${n%2?'available':'selected'}`;});
    return {normal,rerenders,burst};
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}finally{await browser.close();}
