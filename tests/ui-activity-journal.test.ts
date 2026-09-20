import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ActivityJournal } from '../ui/activity-journal.js';

it('persists run start, millisecond activity, and outcome in a private NDJSON timeline',()=>{
  const root=mkdtempSync(join(tmpdir(),'thirsty-run-timing-'));
  try {
    const journal=new ActivityJournal(root);
    const start=journal.begin('testBooking · hybrid','2026-09-21T00:00:00.000Z');
    journal.record(start.runId,{at:'2026-09-21T00:00:01.234Z',text:'Target grid ready',level:'info',elapsedMs:1234,deltaMs:234});
    journal.end(start.runId,'2026-09-21T00:00:02.000Z',2000,'complete');
    const lines=readFileSync(start.path,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    expect(lines.map(line=>line.type)).toEqual(['run-start','activity','run-end']);
    expect(lines[1]).toMatchObject({runId:start.runId,elapsedMs:1234,deltaMs:234});
    expect(lines[2]).toMatchObject({elapsedMs:2000,outcome:'complete'});
  } finally {rmSync(root,{recursive:true,force:true});}
});
