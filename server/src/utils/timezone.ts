export const BUSINESS_TIMEZONE = 'Asia/Kolkata'
export const BUSINESS_LOCALE = 'en-IN'

export interface WallClockParts {
  year: number
  month: number
  day: number
  hour?: number
  minute?: number
  second?: number
  millisecond?: number
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>()

function getPartsFormatter(timeZone: string) {
  let formatter = partsFormatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
    partsFormatterCache.set(timeZone, formatter)
  }
  return formatter
}

const WEEKDAY_TO_SUNDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export function getZonedDateParts(date: Date, timeZone = BUSINESS_TIMEZONE) {
  const parts = getPartsFormatter(timeZone).formatToParts(date)
  const values: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour) === 24 ? 0 : Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    weekday: WEEKDAY_TO_SUNDAY_INDEX[values.weekday] ?? 0,
  }
}

export function getTimeZoneOffsetMsAt(utcMs: number, timeZone = BUSINESS_TIMEZONE): number {
  const p = getZonedDateParts(new Date(utcMs), timeZone)
  const asUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtcMs - Math.floor(utcMs / 1000) * 1000
}

function isValidWallClock(parts: Required<WallClockParts>): boolean {
  if (parts.month < 1 || parts.month > 12) return false
  if (parts.day < 1 || parts.day > 31) return false
  if (parts.hour < 0 || parts.hour > 23) return false
  if (parts.minute < 0 || parts.minute > 59) return false
  if (parts.second < 0 || parts.second > 59) return false
  if (parts.millisecond < 0 || parts.millisecond > 999) return false

  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  return (
    check.getUTCFullYear() === parts.year &&
    check.getUTCMonth() === parts.month - 1 &&
    check.getUTCDate() === parts.day
  )
}

export function zonedWallClockToUtc(input: WallClockParts, timeZone = BUSINESS_TIMEZONE): Date {
  const full: Required<WallClockParts> = {
    year: input.year,
    month: input.month,
    day: input.day,
    hour: input.hour ?? 0,
    minute: input.minute ?? 0,
    second: input.second ?? 0,
    millisecond: input.millisecond ?? 0,
  }
  if (!isValidWallClock(full)) {
    throw new RangeError(`Invalid calendar date/time: ${JSON.stringify(full)}`)
  }

  const targetUtcMs = Date.UTC(
    full.year,
    full.month - 1,
    full.day,
    full.hour,
    full.minute,
    full.second,
    full.millisecond,
  )
  const firstGuess = targetUtcMs - getTimeZoneOffsetMsAt(targetUtcMs, timeZone)
  const refinedOffset = getTimeZoneOffsetMsAt(firstGuess, timeZone)
  return new Date(targetUtcMs - refinedOffset)
}

export function zonedMidnightToUtc(dateKey: string, timeZone = BUSINESS_TIMEZONE): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey.trim())
  if (!match) {
    throw new RangeError(`Invalid calendar date key: ${dateKey}`)
  }
  return zonedWallClockToUtc(
    {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    },
    timeZone,
  )
}

const EXPLICIT_TZ_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i
const NAIVE_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export function parseBusinessDateTime(value: unknown, timeZone = BUSINESS_TIMEZONE): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime())
  }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return null

  if (EXPLICIT_TZ_PATTERN.test(trimmed)) {
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }

  const dtMatch = NAIVE_DATETIME_PATTERN.exec(trimmed)
  if (dtMatch) {
    try {
      const millisecond = dtMatch[7] ? Number(dtMatch[7].padEnd(3, '0')) : 0
      return zonedWallClockToUtc(
        {
          year: Number(dtMatch[1]),
          month: Number(dtMatch[2]),
          day: Number(dtMatch[3]),
          hour: Number(dtMatch[4]),
          minute: Number(dtMatch[5]),
          second: dtMatch[6] ? Number(dtMatch[6]) : 0,
          millisecond,
        },
        timeZone,
      )
    } catch {
      return null
    }
  }

  const dateMatch = DATE_ONLY_PATTERN.exec(trimmed)
  if (dateMatch) {
    try {
      return zonedWallClockToUtc(
        {
          year: Number(dateMatch[1]),
          month: Number(dateMatch[2]),
          day: Number(dateMatch[3]),
        },
        timeZone,
      )
    } catch {
      return null
    }
  }

  return null
}

function addDaysToYmd(year: number, month: number, day: number, deltaDays: number) {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays))
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  }
}

export function resolveBusinessDateRange(
  preset: 'today' | 'this_week' | 'this_month' | 'last_month' | 'custom',
  startDate?: string,
  endDate?: string,
  now = new Date(),
  timeZone = BUSINESS_TIMEZONE,
): { from: Date; to: Date } {
  const dayBounds = (year: number, month: number, day: number) => ({
    from: zonedWallClockToUtc({ year, month, day, hour: 0, minute: 0, second: 0, millisecond: 0 }, timeZone),
    to: zonedWallClockToUtc({ year, month, day, hour: 23, minute: 59, second: 59, millisecond: 999 }, timeZone),
  })

  if (preset === 'custom' && startDate && endDate) {
    const startParsed = parseBusinessDateTime(startDate, timeZone)
    const endParsed = parseBusinessDateTime(endDate, timeZone)
    if (startParsed && endParsed) {
      const startParts = getZonedDateParts(startParsed, timeZone)
      const endParts = getZonedDateParts(endParsed, timeZone)
      return {
        from: dayBounds(startParts.year, startParts.month, startParts.day).from,
        to: dayBounds(endParts.year, endParts.month, endParts.day).to,
      }
    }
  }

  const today = getZonedDateParts(now, timeZone)
  if (preset === 'today') {
    return dayBounds(today.year, today.month, today.day)
  }

  if (preset === 'this_week') {
    const daysSinceMonday = (today.weekday + 6) % 7
    const monday = addDaysToYmd(today.year, today.month, today.day, -daysSinceMonday)
    const sunday = addDaysToYmd(monday.year, monday.month, monday.day, 6)
    return {
      from: dayBounds(monday.year, monday.month, monday.day).from,
      to: dayBounds(sunday.year, sunday.month, sunday.day).to,
    }
  }

  if (preset === 'last_month') {
    const lastMonthFirst = new Date(Date.UTC(today.year, today.month - 2, 1))
    const lastMonthLast = new Date(Date.UTC(today.year, today.month - 1, 0))
    return {
      from: dayBounds(lastMonthFirst.getUTCFullYear(), lastMonthFirst.getUTCMonth() + 1, 1).from,
      to: dayBounds(lastMonthLast.getUTCFullYear(), lastMonthLast.getUTCMonth() + 1, lastMonthLast.getUTCDate()).to,
    }
  }

  const thisMonthLast = new Date(Date.UTC(today.year, today.month, 0))
  return {
    from: dayBounds(today.year, today.month, 1).from,
    to: dayBounds(today.year, today.month, thisMonthLast.getUTCDate()).to,
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  timeZone: BUSINESS_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
})

const dateFormatter = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  timeZone: BUSINESS_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  timeZone: BUSINESS_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

function coerceDisplayDate(value?: Date | string | null): Date | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatIstDateTime(value?: Date | string | null): string {
  const date = coerceDisplayDate(value)
  return date ? dateTimeFormatter.format(date) : '—'
}

export function formatIstDate(value?: Date | string | null): string {
  const date = coerceDisplayDate(value)
  return date ? dateFormatter.format(date) : '—'
}

export function formatIstTime(value?: Date | string | null): string {
  const date = coerceDisplayDate(value)
  return date ? timeFormatter.format(date) : '—'
}
