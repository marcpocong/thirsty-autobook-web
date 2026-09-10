export interface LiveHandoffProof {
  source:'authorized-live-bot-handoff'; observedAt:string; bookingDate:string; court:number; start:string; duration:number; amount:number;
  checkout:true; activeCountdown:true; pending:true; qrPresence:true; amountMatched:true; finalDispatches:1; paymentInteractions:0;
}
// Populated only after the one explicitly authorized live test proves every sentinel.
export const liveHandoffProof:LiveHandoffProof|null={
  source:'authorized-live-bot-handoff',observedAt:'2026-09-10T13:05:22.928Z',bookingDate:'2026-09-11',court:7,start:'12:00',duration:1,amount:600,
  checkout:true,activeCountdown:true,pending:true,qrPresence:true,amountMatched:true,finalDispatches:1,paymentInteractions:0,
};
