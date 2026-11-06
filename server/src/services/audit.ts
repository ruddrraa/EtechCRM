import { AuditEvent } from '../models/AuditEvent.js'

export function recordAudit(actor: string, action: string, entityType: string, entityId: string, metadata?: unknown) {
  return AuditEvent.create({ actor, action, entityType, entityId, metadata })
}
