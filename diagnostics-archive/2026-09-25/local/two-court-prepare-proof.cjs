const { chromium } = require('playwright');
(async()=>{
 const b=await chromium.connectOverCDP('http://127.0.0.1:19446');
 const p=b.contexts().flatMap(c=>c.pages()).find(x=>x.url().includes('index.html'));
 if(!p) throw Error('CONTROL_PAGE_MISSING');
 await p.click('#workflow-test');
 await p.selectOption('#booking-method','api-first');
 await p.selectOption('#booking-type','extended');
 await p.fill('#test-date','2026-09-22');
 await p.selectOption('#court-count','2');
 await p.selectOption('#start-time','12:00');
 await p.fill('#duration','4');
 await p.fill('#maximum','1800');
 await p.click('#prepare');
 await p.waitForFunction(()=>['API READY TO TEST','Needs attention','RESET REQUIRED'].includes(document.querySelector('#headline')?.textContent||''),null,{timeout:120000});
 const result={headline:(await p.textContent('#headline')||'').trim(),detail:(await p.textContent('#detail')||'').trim(),termsAuthorized:await p.isChecked('#terms'),courtCount:await p.inputValue('#court-count'),reservationSubmitted:false,ports:[]};
 for(const port of [19444,19445]){try{const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();result.ports.push({port,ondaPages:tabs.filter(t=>t.type==='page'&&t.url.includes('onda.fit/book/thirsty-pickle')).length});}catch(e){result.ports.push({port,error:String(e)})}}
 console.log(JSON.stringify(result));
 process.exit(result.headline==='API READY TO TEST'&&!result.termsAuthorized&&result.courtCount==='2'&&result.ports.every(x=>x.ondaPages===1)?0:2);
})().catch(e=>{console.error(e.stack||String(e));process.exit(1)});
