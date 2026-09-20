import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityJournal } from '../ui/activity-journal.js';

it('persists browser-ready timing separately and reloads completed run history',()=>{
  const root=mkdtempSync(join(tmpdir(),'thirsty-run-timing-'));
  try {
    const journal=new ActivityJournal(root);
    const start=journal.begin('testBooking · hybrid','2026-09-21T00:00:00.000Z');
    journal.record(start.runId,{at:'2026-09-21T00:00:01.234Z',text:'Target grid ready',level:'info',elapsedMs:1234,deltaMs:234});
    journal.ready(start.runId,'2026-09-21T00:00:01.500Z',1500);
    journal.end(start.runId,'2026-09-21T00:00:02.000Z',2000,'complete',500,'HYBRID TEST');
    const lines=readFileSync(start.path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    expect(lines.map(line=>line.type)).toEqual(['run-start','activity','browser-ready','run-end']);
    expect(lines[1]).toMatchObject({runId:start.runId,elapsedMs:1234,deltaMs:234});
    expect(lines[2]).toMatchObject({elapsedMs:1500});
    expect(lines[3]).toMatchObject({elapsedMs:2000,readyElapsedMs:500,outcome:'complete',label:'HYBRID TEST'});
    expect(journal.history()).toEqual([expect.objectContaining({runId:start.runId,label:'HYBRID TEST',totalElapsedMs:2000,readyElapsedMs:500,outcome:'complete'})]);
  } finally {rmSync(root,{recursive:true,force:true});}
});
