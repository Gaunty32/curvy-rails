import { parsePhoneNumberFromString } from "libphonenumber-js";

export type DayHours = { open: string; close: string } | null;
export type CallbackHours = Record<"monday"|"tuesday"|"wednesday"|"thursday"|"friday"|"saturday"|"sunday", DayHours>;
export const defaultCallbackHours: CallbackHours = {
  monday:{open:"10:00",close:"16:00"}, tuesday:{open:"10:00",close:"16:00"},
  wednesday:{open:"10:00",close:"16:00"}, thursday:{open:"10:00",close:"16:00"},
  friday:{open:"10:00",close:"16:00"}, saturday:null, sunday:null,
};
const weekdays = Object.keys(defaultCallbackHours) as Array<keyof CallbackHours>;
export function normalisePhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const parsed = parsePhoneNumberFromString(input, "GB");
  // libphonenumber marks UK drama/example ranges such as 07700 900123 as
  // possible but not assigned. Accept possible UK structures while still
  // rejecting malformed or impossible numbers.
  return parsed && parsed.countryCallingCode === "44" && (parsed.isValid() || parsed.isPossible())
    ? parsed.number
    : null;
}

export function isCallbackRateLimited(count: number, limit: number): boolean {
  return Number.isFinite(count) && Number.isFinite(limit) && count >= limit;
}
export function parseHours(input: unknown): CallbackHours {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Hours must be an object");
  const source = input as Record<string, unknown>;
  const result = {} as CallbackHours;
  for (const day of weekdays) {
    const value = source[day];
    if (value === null) { result[day] = null; continue; }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid hours for ${day}`);
    const row = value as Record<string, unknown>;
    if (typeof row.open !== "string" || typeof row.close !== "string" ||
        !/^\d{2}:\d{2}$/.test(row.open) || !/^\d{2}:\d{2}$/.test(row.close)) throw new Error(`Invalid hours for ${day}`);
    const [oh,om] = row.open.split(":").map(Number), [ch,cm] = row.close.split(":").map(Number);
    if (oh > 23 || ch > 23 || om > 59 || cm > 59 || oh*60+om >= ch*60+cm) throw new Error(`Close must be after open for ${day}`);
    result[day] = {open:row.open,close:row.close};
  }
  if (Object.keys(source).some(key => !weekdays.includes(key as keyof CallbackHours))) throw new Error("Unknown weekday");
  return result;
}
export function isOpenAt(date: Date, hours: CallbackHours = defaultCallbackHours): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/London",weekday:"long",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const day = parts.find(p=>p.type==="weekday")?.value.toLowerCase() as keyof CallbackHours;
  const time = `${parts.find(p=>p.type==="hour")?.value}:${parts.find(p=>p.type==="minute")?.value}`;
  const range = hours[day]; return !!range && time >= range.open && time < range.close;
}
export function londonMidnight(date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const y = Number(parts.find(p=>p.type==="year")?.value), m = Number(parts.find(p=>p.type==="month")?.value), d = Number(parts.find(p=>p.type==="day")?.value);
  let result = new Date(Date.UTC(y,m-1,d));
  for (let i=0;i<3;i++) {
    const hour = Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",hour:"2-digit",hourCycle:"h23"}).format(result));
    result = new Date(result.getTime() - hour*3600000);
  }
  return result;
}