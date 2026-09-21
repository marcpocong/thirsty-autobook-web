import { z } from 'zod';
import type { Page } from 'playwright';
import { PracticeSchema } from './practice.js';
import { expandHours } from './config.js';
import { navigateDate, snapshot, validateSnapshot, resolvePreference } from './grid.js';
import { selectionPort, selectResolvedPreference } from './selection.js';
import type { Safety } from './safety.js';
import type { Telemetry } from './telemetry.js';
export const FullPracticeSchema = z.object({ target: PracticeSchema, maximum: z.number().optional(), authorizeTerms: z.literal(true) }).strict();
export type FullPracticeInput = z.infer<typeof FullPracticeSchema>;
export async function selectExactPractice(page:Page,input:FullPracticeInput,safety:Safety,t:Telemetry){
  const parsed=FullPracticeSchema.parse(input), target=parsed.target;
  const port=selectionPort(page,safety);await port.guard();
  if((await page.getByTestId('booking-court-filter-label').innerText()).trim()!=='All Courts')throw Error('COURT_FILTER_NOT_ALL');
  const initial=await snapshot(page);
  const initialCells=validateSnapshot(initial,initial.rows[0]?.date??'');
  if(initialCells.some(c=>c.state==='UNKNOWN'))throw Error('SELECTION_STATE_UNKNOWN');
  if(initialCells.some(c=>c.state==='SELECTED'))throw Error('PREEXISTING_SELECTION');
  try {await navigateDate(page,target.date,safety);}catch(error){if(error instanceof Error&&error.message==='TARGET_DATE_UNAVAILABLE')throw Error('PRACTICE_DATE_UNAVAILABLE');throw error;}
  const grid=await snapshot(page), cells=validateSnapshot(grid,target.date);
  const exact={court:target.court,hours:expandHours(target.start,target.duration)};
  if(!resolvePreference(cells,[exact]))throw Error('PRACTICE_TARGET_UNAVAILABLE');
  return selectResolvedPreference(port,target.date,grid,[exact],parsed.maximum??Infinity,1,safety,t);
}
