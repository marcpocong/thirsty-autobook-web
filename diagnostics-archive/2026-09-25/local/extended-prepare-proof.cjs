const { chromium } = require('playwright');
(async()=>{
  const b=await chromium.connectOverCDP('http://127.0.0.1:19446');
  const pages=b.contexts().flatMap(c=>c.pages());
  const p=pages.find(x=>x.url().includes('index.html'))||pages[0];
  if(!p) throw Error('CONTROL_PAGE_MISSING');
  await p.click('#workflow-test');
  await p.selectOption('#booking-method','api-first');
  await p.selectOption('#booking-type','extended');
  await p.fill('#test-date','2026-09-22');
  await p.selectOption('#court-count','1');
  await p.selectOption('#start-time','12:00');
  await p.fill('#duration','4');
  await p.fill('#maximum','1800');
  await p.click('#prepare');
  await p.waitForFunction(()=>{
    const h=document.querySelector('#headline')?.textContent||'';
    return h==='API READY TO TEST'||h==='Needs attention';
  },null,{timeout:120000});
  const headline=(await p.textContent('#headline')||'').trim();
  const detail=(await p.textContent('#detail')||'').trim();
  const terms=await p.isChecked('#terms');
  const ports=[];
  for(const port of [19444,19445]){
    try{
      const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      ports.push({port,exactOndaTabs:tabs.filter(t=>t.url==='https://book.onda.fit/venues/thirsty-pickle').length,tabs:tabs.length});
    }catch(e){ports.push({port,error:String(e)})}
  }
  console.log(JSON.stringify({headline,detail,termsAuthorized:terms,reservationSubmitted:false,ports}));
  process.exit(headline==='API READY TO TEST'&&ports.every(x=>x.exactOndaTabs===1)&&!terms?0:2);
})().catch(e=>{console.error(e.stack||String(e));process.exit(1)});
