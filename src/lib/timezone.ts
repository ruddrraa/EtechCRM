export const BUSINESS_TIMEZONE = 'Asia/Kolkata'
export const BUSINESS_LOCALE = 'en-IN'

const EXPLICIT_TZ_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i
const NAIVE_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const istPartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

function getIstOffsetMsAt(utcMs: number): number {
  const values: Record<string, string> = {}
  for (const part of istPartsFormatter.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') values[part.type] = part.value
  }
  const hour = Number(values.hour)
  const asUtcMs = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    hour === 24 ? 0 : hour,
    Number(values.minute),
    Number(values.second),
  )
  return asUtcMs - Math.floor(utcMs / 1000) * 1000
}

/**
 * Converts a naive datetime-local string (`YYYY-MM-DDTHH:mm`) or date string (`YYYY-MM-DD`)
 * entered in Asia/Kolkata business time into an exact UTC ISO-8601 instant string.
 * Strings that already include an explicit timezone offset (`Z` or `±HH:MM`) are normalized
 * without double conversion.
 */
export function toIstUtcIso(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return trimmed

  if (EXPLICIT_TZ_PATTERN.test(trimmed)) {
    const parsed = new Date(trimmed)
    return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString()
  }

  const dtMatch = NAIVE_DATETIME_PATTERN.exec(trimmed)
  if (dtMatch) {
    const ms = dtMatch[7] ? Number(dtMatch[7].padEnd(3, '0')) : 0
    const targetUtcMs = Date.UTC(
      Number(dtMatch[1]),
      Number(dtMatch[2]) - 1,
      Number(dtMatch[3]),
      Number(dtMatch[4]),
      Number(dtMatch[5]),
      dtMatch[6] ? Number(dtMatch[6]) : 0,
      ms,
    )
    const firstGuess = targetUtcMs - getIstOffsetMsAt(targetUtcMs)
    const refinedOffset = getIstOffsetMsAt(firstGuess)
    return new Date(targetUtcMs - refinedOffset).toISOString()
  }

  const dateMatch = DATE_ONLY_PATTERN.exec(trimmed)
  if (dateMatch) {
    const targetUtcMs = Date.UTC(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      0,
      0,
      0,
      0,
    )
    const firstGuess = targetUtcMs - getIstOffsetMsAt(targetUtcMs)
    const refinedOffset = getIstOffsetMsAt(firstGuess)
    return new Date(targetUtcMs - refinedOffset).toISOString()
  }

  return trimmed
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

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIMEZONE,
  month: 'short',
  day: 'numeric',
})

const timeFormatter = new Intl.DateTimeFormat(BUSINESS_LOCALE, {
  timeZone: BUSINESS_TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

const istDateInputFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function getIstDateInputValue(value: Date = new Date()): string {
  return istDateInputFormatter.format(value)
}

export const DEFAULT_REPORT_PRESET = 'today' as const

export function getDefaultReportFilterState(referenceDate: Date = new Date()) {
  const todayIst = getIstDateInputValue(referenceDate)
  return {
    preset: DEFAULT_REPORT_PRESET,
    startDate: todayIst,
    endDate: todayIst,
  }
}

function coerceDisplayDate(value?: Date | string | number | null): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatIstDateTime(value?: Date | string | number | null): string {
  const date = coerceDisplayDate(value)
  return date ? dateTimeFormatter.format(date) : '—'
}

export function formatIstDate(value?: Date | string | number | null): string {
  const date = coerceDisplayDate(value)
  return date ? dateFormatter.format(date) : '—'
}

export function formatIstShortDate(value?: Date | string | number | null): string {
  const date = coerceDisplayDate(value)
  return date ? shortDateFormatter.format(date) : '—'
}

export function formatIstTime(value?: Date | string | number | null): string {
  const date = coerceDisplayDate(value)
  return date ? timeFormatter.format(date) : '—'
}
