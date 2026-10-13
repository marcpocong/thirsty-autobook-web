import type { BookingPlan } from './types.js';

export function standardCheckoutChunks(plan: BookingPlan): BookingPlan[] {
  if (plan.mode === 'standard') {
    if (plan.chunks.length !== 1 || ![1,2,3,4,5,6,7].includes(plan.chunks[0]?.courts.length ?? 0)) throw Error('API_STANDARD_CHUNK_INVALID');
  } else if (plan.chunks.length !== 2 || plan.durationHours < 4 || plan.durationHours > 6 ||
    plan.chunks.some(chunk => chunk.courts.length !== plan.chunks[0]!.courts.length || ![1,2,3,4,5,6,7].includes(chunk.courts.length) ||
      chunk.durationHours < 1 || chunk.durationHours > 3)) {
    throw Error('API_EXTENDED_CHUNK_INVALID');
  }
  return plan.chunks.flatMap(chunk => {
    const groups=[];
    for(let index=0;index<chunk.courts.length;index+=2)groups.push(chunk.courts.slice(index,index+2));
    return groups.map(courts=>{
      const totalPrice=courts.reduce((sum,court)=>sum+court.price,0);
      const checkoutChunk={...chunk,courts,totalPrice};
      return { ...(plan.wing ? {wing:plan.wing} : {}), mode:'standard' as const,targetDate:plan.targetDate,startTime:chunk.startTime,endTime:chunk.endTime,
        durationHours:chunk.durationHours,courts,chunks:[checkoutChunk],totalPrice,currency:plan.currency };
    });
  });
}
