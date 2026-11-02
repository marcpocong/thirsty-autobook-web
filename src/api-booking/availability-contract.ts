import {FACILITY_ID} from '../court-registry.js';

/** Observed official calendar contract. No guessed endpoints or credential replay. */
export const AVAILABILITY_ORIGIN='https://app.onda.fit';
export const AVAILABILITY_PATH=`/api/public/facilities/${FACILITY_ID}/date-availability`;
export function availabilityRequestPath(startDate:string,endDate=startDate):string{
  const valid=(date:string)=>/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(`${date}T00:00:00Z`))&&new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)===date;
  if(!valid(startDate)||!valid(endDate)||endDate<startDate)throw Error('AVAILABILITY_QUERY_INVALID');
  return `${AVAILABILITY_PATH}?${new URLSearchParams({startDate,endDate,duration:'60',includeSchedule:'true',includeMemberOnlyAccess:'true',slotDateMode:'web-operating-day'})}`;
}

export const AVAILABILITY_STATUSES=['AVAILABILITY_CONFIRMED','AVAILABILITY_UNRELEASED','AVAILABILITY_UNKNOWN','AVAILABILITY_AUTH_REQUIRED','AVAILABILITY_ACCESS_DENIED','AVAILABILITY_RATE_LIMITED','AVAILABILITY_ENDPOINT_UNSUPPORTED','AVAILABILITY_RESPONSE_INCOMPATIBLE','AVAILABILITY_STALE','AVAILABILITY_TRANSPORT_FAILED'] as const;
export type AvailabilityStatus=typeof AVAILABILITY_STATUSES[number];
export function availabilityFailureStatus(error:unknown):AvailabilityStatus{
  const e=error as {httpStatus?:number;code?:string;message?:string}|undefined,code=e?.code??e?.message??'';
  if(e?.httpStatus===401)return 'AVAILABILITY_AUTH_REQUIRED';
  if(e?.httpStatus===403)return 'AVAILABILITY_ACCESS_DENIED';
  if(e?.httpStatus===429)return 'AVAILABILITY_RATE_LIMITED';
  if(e?.httpStatus===404||e?.httpStatus===410)return 'AVAILABILITY_ENDPOINT_UNSUPPORTED';
  if(/STALE/.test(code))return 'AVAILABILITY_STALE';
  if(/TRANSPORT|TIMEOUT|BODY_FAILED/.test(code))return 'AVAILABILITY_TRANSPORT_FAILED';
  if(/INVALID|CONFLICT|INCOMPATIBLE|UNKNOWN_COURT|MISMATCH|SITE_HELPER|MEMBERSHIP|INCOMPLETE|TOO_LARGE|CLOSE_FAILED/.test(code))return 'AVAILABILITY_RESPONSE_INCOMPATIBLE';
  return 'AVAILABILITY_UNKNOWN';
}
export function availabilityStatusLabel(status:AvailabilityStatus):string{
  return ({AVAILABILITY_CONFIRMED:'Availability verified',AVAILABILITY_UNRELEASED:'Not published yet',AVAILABILITY_UNKNOWN:'Availability unknown',AVAILABILITY_AUTH_REQUIRED:'Sign-in required',AVAILABILITY_ACCESS_DENIED:'Availability request denied',AVAILABILITY_RATE_LIMITED:'Provider rate limit',AVAILABILITY_ENDPOINT_UNSUPPORTED:'Availability endpoint unsupported',AVAILABILITY_RESPONSE_INCOMPATIBLE:'Availability response incompatible',AVAILABILITY_STALE:'Availability evidence stale',AVAILABILITY_TRANSPORT_FAILED:'Availability connection failed'})[status];
}
