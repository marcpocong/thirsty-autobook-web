import { z } from 'zod';
import { verifiedAvailabilitySession } from './verified-availability-session.js';
import { parseAvailability } from './availability-parser.js';
import { emitUiEvent } from '../ui-events.js';
const {date}=z.object({date:z.iso.date()}).strict().parse(JSON.parse(process.argv[2]??'{}'));
const session=await verifiedAvailabilitySession();
try {
  const cells=[];let capturedAt:string|undefined;
  for(const wing of ['MANGO','BUKO'] as const){
    const envelope=await session.provider(wing).getAvailability({startDate:date,endDate:date});
    capturedAt??=envelope.capturedAt;
    const snapshot=parseAvailability(envelope.raw,{wing,startDate:date,endDate:date,capturedAt:envelope.capturedAt,fixtureKind:envelope.fixtureKind,label:envelope.label,now:new Date(),maximumAgeMs:15_000,requireCompleteRange:false});
    cells.push(...snapshot.slots.filter(slot=>slot.date===date).map(slot=>({wing,court:slot.court,start:slot.startTime,available:slot.isAvailable,price:slot.price??null})));
  }
  emitUiEvent({type:'courtBrowser',date,capturedAt:capturedAt!,cells});
}finally{await session.close();}
