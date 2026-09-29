import { resolve } from 'node:path';
import { buildReleaseForensics, forensicInputsFor } from '../src/release-forensics.js';
import { buildReleaseLabForRun } from '../src/release-lab-analysis.js';

const runId=process.argv[2];
if(!runId||!/^[0-9a-f-]{36}$/.test(runId))throw Error('Usage: npm run release-lab:rebuild -- <run-id>');
const root=resolve('.'),inputs=forensicInputsFor(root,runId);
if(!inputs)throw Error('RELEASE_LAB_RAW_RUN_NOT_FOUND');
const forensics=buildReleaseForensics({...inputs,status:'final'}),summary=buildReleaseLabForRun(root,runId,forensics);
if(!summary)throw Error('RELEASE_LAB_PHASE3_FREEZE_NOT_FOUND');
process.stdout.write(JSON.stringify({runId,summaryPath:summary.summaryPath,reportPath:summary.reportPath,attempts:summary.attempts.length})+'\n');
