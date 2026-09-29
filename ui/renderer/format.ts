/** Shared operator-facing formatting for the renderer modules. */
export const friendly = (h: string) => `${Number(h.slice(0, 2)) % 12 || 12}:00 ${Number(h.slice(0, 2)) < 12 ? 'AM' : 'PM'}`;
export const dateLabel = (date: string) => new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
/** Release-relative milliseconds as signed seconds with millisecond precision, e.g. "+1.234 s". */
export const relative = (ms: number) => `${ms < 0 ? '−' : '+'}${(Math.abs(ms) / 1000).toFixed(3)} s`;
export const manilaMs = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 });
/** The 16 bookable hours, 08:00 through 23:00. */
export const hours=Array.from({length:16},(_,i)=>`${String(i+8).padStart(2,'0')}:00`);
export function hourlySlots(start:string,end:string){const first=Number(start.slice(0,2)),last=Number(end.slice(0,2));return Array.from({length:Math.max(0,last-first)},(_,i)=>`${String(first+i).padStart(2,'0')}:00–${String(first+i+1).padStart(2,'0')}:00`);}
export const slotStateInfo={OPEN:{label:'Open',symbol:'✓',css:'slot-open'},TAKEN:{label:'Unavailable',symbol:'×',css:'slot-taken'},UNRELEASED:{label:'Not published yet',symbol:'—',css:'slot-unreleased'},UNKNOWN:{label:'Unknown',symbol:'?',css:'slot-unknown'}} as const;
export const evidenceLabel={OPEN:'Open',UNAVAILABLE:'Unavailable',UNKNOWN:'Unknown'} as const;
export const evidenceSlot={OPEN:'OPEN',UNAVAILABLE:'TAKEN',UNKNOWN:'UNKNOWN'} as const;
export type ReadRef={seq:number;requestOffsetMs:number;responseOffsetMs:number};
/** A read is shown by its request start AND its response; the state it returned existed somewhere in between. */
export const readText=(read:ReadRef,prefix='#')=>`${prefix}${read.seq} req ${relative(read.requestOffsetMs)} → resp ${relative(read.responseOffsetMs)}`;
