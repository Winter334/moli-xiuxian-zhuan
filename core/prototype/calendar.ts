export const MINUTES_PER_DAY = 10800;
const DAYS_PER_YEAR = 50;
const YEARS_PER_ERA = 10081;
export const INITIAL_CALENDAR_MINUTES = ((1370 - 1) * DAYS_PER_YEAR + 18) * MINUTES_PER_DAY + 48 * 60;
export const WORLD_EPOCH_MS = Date.UTC(2026, 8, 29);
export const WORLD_DAY_MS = 30 * 60 * 1000;

export function worldCalendarAt(worldTimeMs: number) {
  if (!Number.isSafeInteger(worldTimeMs) || worldTimeMs < 0) throw new Error('Invalid world time');
  const elapsedSeconds = Math.floor(Math.max(0, worldTimeMs - WORLD_EPOCH_MS) / 1000);
  return calendarAt(INITIAL_CALENDAR_MINUTES + elapsedSeconds * (MINUTES_PER_DAY / (WORLD_DAY_MS / 1000)));
}

export function calendarAt(minutes: number) {
  if (!Number.isSafeInteger(minutes) || minutes < 0) throw new Error('Invalid calendar');
  const absoluteDay = Math.floor(minutes / MINUTES_PER_DAY);
  const absoluteYear = Math.floor(absoluteDay / DAYS_PER_YEAR);
  const year = absoluteYear % YEARS_PER_ERA + 1;
  const day = absoluteDay % DAYS_PER_YEAR + 1;
  const minuteOfDay = minutes % MINUTES_PER_DAY;
  const referenceHour = Math.floor(minuteOfDay / 60);
  const localSecond = minuteOfDay * 8;
  return {
    dayIndex: absoluteDay,
    referenceEra: 31698 + Math.floor(absoluteYear / YEARS_PER_ERA),
    referenceYear: year,
    referenceDay: day,
    referenceHour,
    year: absoluteYear - 1368,
    month: Math.floor((day - 1) / 10) + 1,
    day: (day - 1) % 10 + 1,
    hour: Math.floor(localSecond / 3600),
    minute: Math.floor(localSecond % 3600 / 60),
    second: localSecond % 60,
    doubleHour: Math.floor(minuteOfDay / 900),
    moonPhase: ((year % 4) * 100 + day * 2 + Math.floor(referenceHour / 90)) % 8,
    isNight: referenceHour >= 150 || referenceHour <= 30,
  };
}
