import { AuditEvent } from '../models/AuditEvent.js';
export function recordAudit(actor, action, entityType, entityId, metadata) {
    return AuditEvent.create({ actor, action, entityType, entityId, metadata });
}
