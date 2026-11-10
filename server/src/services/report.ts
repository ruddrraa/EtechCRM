import mongoose from 'mongoose'
import PDFDocument from 'pdfkit'
import * as XLSX from 'xlsx'
import { User } from '../models/User.js'
import { Visit } from '../models/Visit.js'
import { getOrganizationConfig } from './organization.js'
import type { AuthUser } from '../middleware/auth.js'
import { isExecutiveRole } from '../middleware/auth.js'
import { AppError } from '../utils/errors.js'
import type { ReportQuery } from '../validators/report.js'

const activeExecutiveRoles = { $in: ['MARKETING_EXECUTIVE', 'USER'] }
type Location = { latitude?: number; longitude?: number; recordedAt?: Date | string; locationStatus?: string }
type VisitRow = {
  _id: unknown
  client: { _id: unknown; organisationName: string; category: string; contactPerson?: string; phone?: string; email?: string; address: string }
  assignedTo: { _id: unknown; name: string; designation?: string; email?: string; reportingTo?: unknown }
  marketingHead?: { name?: string; _id?: unknown }
  plannedDate: Date | string
  createdAt?: Date | string
  arrivedAt?: Date | string
  status: string
  checkIn?: Location
  checkOut?: Location
  remarks?: string
  followUpDate?: Date | string
}

function range(query: ReportQuery) {
  const day = (value: string, end = false) => {
    const result = new Date(value)
    if (end) result.setHours(23, 59, 59, 999)
    else result.setHours(0, 0, 0, 0)
    return result
  }
  if (query.preset === 'custom') return { from: day(query.startDate!), to: day(query.endDate!, true) }
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (query.preset === 'today') return { from: today, to: day(today.toISOString(), true) }
  if (query.preset === 'this_week') {
    const from = new Date(today)
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7))
    return { from, to: new Date(from.getTime() + 7 * 86400000 - 1) }
  }
  if (query.preset === 'last_month') return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59, 999) }
  return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999) }
}

async function scope(user: AuthUser) {
  if (isExecutiveRole(user.role)) return { assignedTo: new mongoose.Types.ObjectId(user.id) }
  if (user.role === 'MARKETING_HEAD') {
    const team = await User.find({ reportingTo: user.id, role: activeExecutiveRoles }).select('_id').lean()
    return { assignedTo: { $in: team.map((item) => item._id) } }
  }
  return {}
}

function objectId(value?: string) {
  return value ? new mongoose.Types.ObjectId(value) : undefined
}

async function visitPipeline(user: AuthUser, query: ReportQuery, extra: Record<string, unknown> = {}) {
  const period = range(query)
  const match: Record<string, unknown> = { ...(await scope(user)), ...extra, plannedDate: { $gte: period.from, $lte: period.to } }
  if (query.status) match.status = query.status
  if (query.clientId) match.client = objectId(query.clientId)
  if (query.staffId) match.assignedTo = objectId(query.staffId)
  const pipeline: mongoose.PipelineStage[] = [
    { $match: match },
    { $lookup: { from: 'clients', localField: 'client', foreignField: '_id', as: 'client' } },
    { $unwind: '$client' },
    { $lookup: { from: 'users', localField: 'assignedTo', foreignField: '_id', as: 'assignedTo' } },
    { $unwind: '$assignedTo' },
    { $lookup: { from: 'users', localField: 'marketingHeadAtAssignment', foreignField: '_id', as: 'historicalHead' } },
    { $unwind: { path: '$historicalHead', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'users', localField: 'assignedTo.reportingTo', foreignField: '_id', as: 'currentHead' } },
    { $unwind: { path: '$currentHead', preserveNullAndEmptyArrays: true } },
    { $addFields: { marketingHead: { $ifNull: ['$historicalHead', '$currentHead'] }, marketingHeadId: { $ifNull: ['$marketingHeadAtAssignment', '$assignedTo.reportingTo'] } } },
    ...(query.categoryId ? [{ $match: { 'client.categoryId': objectId(query.categoryId) } }] : query.category ? [{ $match: { $or: [{ 'client.category': query.category }, ...(mongoose.isValidObjectId(query.category) ? [{ 'client.categoryId': objectId(query.category) }] : [])] } }] : []),
    ...(query.headId ? [{ $match: { marketingHeadId: objectId(query.headId) } }] : []),
  ]
  return pipeline
}

function sortStage(query: ReportQuery): mongoose.PipelineStage.Sort {
  const field = query.sort === 'clientName' ? 'client.organisationName' : query.sort === 'executiveName' ? 'assignedTo.name' : 'plannedDate'
  return { $sort: { [field]: query.order === 'asc' ? 1 : -1, _id: -1 } }
}

export const MAX_VISIT_DETAILS_ROWS = 500
export const MAX_EXPORT_ROWS = 5000

function statusSummaryFromCounts(counts: Array<{ _id: string; count: number }>) {
  return counts.reduce(
    (summary, item) => {
      summary.total += item.count
      if (item._id === 'COMPLETED') summary.completed += item.count
      else if (item._id === 'CANCELLED') summary.cancelled += item.count
      else summary.pending += item.count
      return summary
    },
    { total: 0, completed: 0, pending: 0, cancelled: 0 }
  )
}

export async function getReport(user: AuthUser, query: ReportQuery, view: 'client' | 'staff') {
  void view
  const page = query.page ?? 1
  const limit = query.limit ?? 20
  const pipeline = await visitPipeline(user, query)
  const [result] = await Visit.aggregate([
    ...pipeline,
    {
      $facet: {
        items: [sortStage(query), { $skip: (page - 1) * limit }, { $limit: limit }],
        all: [{ $count: 'value' }],
        statuses: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
      },
    },
  ]) as Array<{ items: VisitRow[]; all: Array<{ value: number }>; statuses: Array<{ _id: string; count: number }> }>

  const total = result?.all?.[0]?.value ?? 0
  return {
    items: result?.items ?? [],
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    summary: statusSummaryFromCounts(result?.statuses ?? []),
  }
}

export async function getVisitDetails(user: AuthUser, query: ReportQuery, field: 'client' | 'assignedTo', value: string) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(400, 'Invalid report filter')
  const pipeline = await visitPipeline(user, query, { [field]: new mongoose.Types.ObjectId(value) })
  return await Visit.aggregate([...pipeline, sortStage(query), { $limit: MAX_VISIT_DETAILS_ROWS }]) as VisitRow[]
}

function safeCell(value: unknown) {
  const text = value == null ? '' : String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

function dateText(value?: Date | string) {
  return value ? new Date(value).toLocaleString() : '—'
}

function locationText(location?: Location) {
  if (!location || location.locationStatus === 'LOCATION_UNAVAILABLE') return '—'
  if (location.latitude === undefined || location.longitude === undefined) return '—'
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
}

function exportRows(visits: VisitRow[], view: 'client' | 'staff') {
  return visits.map((visit) => view === 'client'
    ? {
      'Client Name': visit.client.organisationName,
      'Visit Date': dateText(visit.plannedDate),
      Status: visit.status,
      'Check-in Time': dateText(visit.checkIn?.recordedAt),
      'Check-out Time': dateText(visit.checkOut?.recordedAt),
      'Check-in Coordinates': locationText(visit.checkIn),
      'Check-out Coordinates': locationText(visit.checkOut),
      Location: visit.client.address,
      'Executive Name': visit.assignedTo.name,
      Remarks: visit.remarks ?? '—',
      'Follow-up Date': dateText(visit.followUpDate),
      'Marketing Head': visit.marketingHead?.name ?? '—',
    }
    : {
      'Executive Name': visit.assignedTo.name,
      Designation: visit.assignedTo.designation ?? '—',
      'Marketing Head': visit.marketingHead?.name ?? '—',
      'Client Name': visit.client.organisationName,
      'Visit Date': dateText(visit.plannedDate),
      Status: visit.status,
      'Check-in Time': dateText(visit.checkIn?.recordedAt),
      'Check-out Time': dateText(visit.checkOut?.recordedAt),
      'Check-in Coordinates': locationText(visit.checkIn),
      'Check-out Coordinates': locationText(visit.checkOut),
      Location: visit.client.address,
      Remarks: visit.remarks ?? '—',
      'Follow-up Date': dateText(visit.followUpDate),
    })
}

function filterText(query: ReportQuery) {
  return Object.entries(query).filter(([key, value]) => value !== undefined && !['page', 'limit', 'sort', 'order'].includes(key)).map(([key, value]) => `${key}: ${value}`).join(', ') || 'All permitted records'
}

export async function exportReport(user: AuthUser, query: ReportQuery, view: 'client' | 'staff', format: 'csv' | 'xlsx' | 'pdf') {
  const [pipeline, org] = await Promise.all([
    visitPipeline(user, query),
    getOrganizationConfig(),
  ])
  const orgName = org?.name?.trim() || 'Excel Technologies and Services'
  const visits = await Visit.aggregate([...pipeline, sortStage(query), { $limit: MAX_EXPORT_ROWS + 1 }]) as VisitRow[]
  if (visits.length > MAX_EXPORT_ROWS) {
    throw new AppError(422, `Export exceeds the ${MAX_EXPORT_ROWS.toLocaleString()}-row limit. Please narrow your date or status filters.`)
  }
  const rows = exportRows(visits, view).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, safeCell(value)])))
  const title = `${orgName} - ${view === 'client' ? 'Client Wise' : 'Staff Wise'} Visit Report`
  const headers = Object.keys(rows[0] ?? (view === 'client' ? { 'Client Name': '' } : { 'Executive Name': '' }))
  if (format === 'csv') {
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
    return { contentType: 'text/csv; charset=utf-8', filename: `${view}-visit-report.csv`, body: `\ufeff${headers.map(escape).join(',')}\r\n${rows.map((row) => headers.map((header) => escape(row[header])).join(',')).join('\r\n')}` }
  }
  if (format === 'xlsx') {
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet(rows, { header: headers })
    sheet['!cols'] = headers.map(() => ({ wch: 20 }))
    sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${rows.length + 1}` }
    sheet['!freeze'] = { xSplit: 0, ySplit: 1 }
    XLSX.utils.book_append_sheet(workbook, sheet, 'Visit Details')
    const summary = XLSX.utils.aoa_to_sheet([[title], ['Organization', orgName], ['Generated', new Date().toLocaleString()], ['Filters', filterText(query)]])
    summary['!cols'] = [{ wch: 18 }, { wch: 80 }]
    XLSX.utils.book_append_sheet(workbook, summary, 'Summary')
    return { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `${view}-visit-report.xlsx`, body: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) }
  }
  const document = new PDFDocument({ size: 'A3', layout: 'landscape', margin: 28, bufferPages: true })
  const chunks: Buffer[] = []
  document.on('data', (chunk) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve) => document.on('end', () => resolve(Buffer.concat(chunks))))
  const widths = headers.map(() => (document.page.width - 56) / headers.length)
  const drawHeader = () => {
    document.fontSize(16).fillColor('#171717').text(title, 28, 24)
    document.fontSize(8).fillColor('#555').text(`Organization: ${orgName} · Generated: ${new Date().toLocaleString()} · Filters: ${filterText(query)}`, 28, 45)
    let x = 28
    document.fontSize(7).fillColor('#fff')
    headers.forEach((header, index) => { document.rect(x, 68, widths[index], 24).fill('#202020'); document.fillColor('#fff').text(header, x + 3, 76, { width: widths[index] - 6, height: 16 }); x += widths[index] })
    return 92
  }
  let y = drawHeader()
  for (const row of rows) {
    const lines = headers.map((header) => document.heightOfString(String(row[header] ?? '—'), { width: widths[headers.indexOf(header)] - 6 }))
    const height = Math.max(22, Math.min(60, Math.max(...lines) + 8))
    if (y + height > document.page.height - 42) { document.addPage(); y = drawHeader() }
    let x = 28
    headers.forEach((header, index) => { document.rect(x, y, widths[index], height).stroke('#d9d9d6'); document.fontSize(7).fillColor('#171717').text(String(row[header] ?? '—'), x + 3, y + 4, { width: widths[index] - 6, height: height - 6 }); x += widths[index] })
    y += height
  }
  const pages = document.bufferedPageRange()
  for (let page = pages.start; page < pages.start + pages.count; page += 1) { document.switchToPage(page); document.fontSize(8).fillColor('#555').text(`${orgName} · Page ${page - pages.start + 1} of ${pages.count}`, 28, document.page.height - 25, { align: 'center', width: document.page.width - 56 }) }
  document.end()
  return { contentType: 'application/pdf', filename: `${view}-visit-report.pdf`, body: await done }
}
