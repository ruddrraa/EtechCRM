import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { apiFetch } from '../../lib/api'
import { formatIstDate } from '../../lib/timezone'
import { HardDrive, FileCheck, Layers, Clock, Cloud, ShieldCheck, Trash2 } from 'lucide-react'

interface OrphanReport {
  dryRun: boolean
  minAgeHours: number
  verifyCloud: boolean
  cutoffDate: string
  summary: {
    pendingCloudDeletes: number
    unregisteredCloudAssets: number
    staleDbRecords: number
    cleanedPendingCloudDeletes: number
    cleanedUnregisteredCloudAssets: number
    archivedStaleDbRecords: number
    errors: number
  }
}

interface StorageStats {
  totalFiles: number
  totalBytes: number
  totalMegabytes: number
  byCategory: Record<string, { count: number; bytes: number }>
  recentUploads: Array<{
    _id: string
    originalName: string
    ownerType: string
    sizeBytes: number
    mimeType: string
    uploadedBy: string
    createdAt: string
  }>
  storageProvider: string
  isLiveCloudinary: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
}

function formatCategory(key: string): string {
  switch (key) {
    case 'USER_AVATAR':
      return 'Staff Avatars'
    case 'CLIENT_VISITING_CARD':
      return 'Visiting Cards'
    case 'CLIENT_DOCUMENT':
      return 'Client Documents'
    case 'VISIT_PHOTO':
      return 'Visit Photos'
    case 'VISIT_ATTACHMENT':
      return 'Visit Attachments'
    default:
      return key
  }
}

export function StorageDashboard() {
  const queryClient = useQueryClient()
  const [orphanReport, setOrphanReport] = useState<OrphanReport | null>(null)
  const [orphanError, setOrphanError] = useState<string | null>(null)

  const { data: stats, isLoading, isError } = useQuery<StorageStats>({
    queryKey: ['settings', 'storageDashboard'],
    queryFn: () => apiFetch<StorageStats>('/files/storage/dashboard'),
    staleTime: 30000,
  })

  const orphanAuditMutation = useMutation({
    mutationFn: () => apiFetch<OrphanReport>('/files/storage/orphans?minAgeHours=24&verifyCloud=true'),
    onSuccess: (report) => {
      setOrphanError(null)
      setOrphanReport(report)
    },
    onError: (err: Error) => {
      setOrphanError(err.message)
    },
  })

  const orphanCleanupMutation = useMutation({
    mutationFn: () =>
      apiFetch<OrphanReport>('/files/storage/orphans/cleanup', {
        method: 'POST',
        body: JSON.stringify({ dryRun: false, minAgeHours: 24, verifyCloud: true }),
      }),
    onSuccess: (report) => {
      setOrphanError(null)
      setOrphanReport(report)
      void queryClient.invalidateQueries({ queryKey: ['settings', 'storageDashboard'] })
    },
    onError: (err: Error) => {
      setOrphanError(err.message)
    },
  })

  return (
    <Card>
      <div className="section-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <HardDrive size={22} className="text-primary" />
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0 }}>File &amp; Media Management</h2>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--muted)' }}>
              Centralized file asset metrics, storage usage and recent uploads.
            </p>
          </div>
        </div>

        {stats && (
          <Badge tone={stats.isLiveCloudinary ? 'success' : 'neutral'}>
            <Cloud size={12} style={{ marginRight: '4px', display: 'inline' }} />
            {stats.isLiveCloudinary ? 'File Storage Active' : 'Offline Dev Storage'}
          </Badge>
        )}
      </div>

      {isLoading ? (
        <p style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>Loading storage statistics...</p>
      ) : isError || !stats ? (
        <p style={{ color: '#e11d48', fontSize: '0.875rem' }}>Unable to load storage overview.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Summary KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', background: 'var(--surface-muted, #fafafa)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                <FileCheck size={16} /> Total Managed Files
              </div>
              <strong style={{ fontSize: '1.5rem', fontWeight: 700 }}>{stats.totalFiles}</strong>
            </div>

            <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', background: 'var(--surface-muted, #fafafa)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                <HardDrive size={16} /> Total Managed Volume
              </div>
              <strong style={{ fontSize: '1.5rem', fontWeight: 700 }}>{formatBytes(stats.totalBytes)}</strong>
              <small style={{ display: 'block', fontSize: '0.72rem', color: 'var(--muted)', marginTop: '2px' }}>
                * Aggregated from system asset records
              </small>
            </div>
          </div>

          {/* Breakdown by Category */}
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Layers size={16} /> File Breakdown by Entity Type
            </h3>
            {Object.keys(stats.byCategory).length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>No files uploaded yet.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                {Object.entries(stats.byCategory).map(([cat, info]) => (
                  <div key={cat} style={{ border: '1px solid var(--border)', borderRadius: '6px', padding: '0.75rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--muted)', display: 'block' }}>{formatCategory(cat)}</span>
                    <strong style={{ fontSize: '1.1rem' }}>{info.count} files</strong>
                    <span style={{ fontSize: '0.75rem', color: 'var(--muted)', display: 'block' }}>{formatBytes(info.bytes)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Uploads */}
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={16} /> Recent Uploads
            </h3>
            {stats.recentUploads.length === 0 ? (
              <p style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>No recent upload activity.</p>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--surface-muted, #f8f9fa)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem 0.75rem' }}>File Name</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Category</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Size</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Uploaded By</th>
                      <th style={{ padding: '0.5rem 0.75rem' }}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentUploads.map((file) => (
                      <tr key={file._id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.5rem 0.75rem', fontWeight: 500 }}>{file.originalName}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{formatCategory(file.ownerType)}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{formatBytes(file.sizeBytes)}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{file.uploadedBy}</td>
                        <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)' }}>{formatIstDate(file.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Safe Orphan Storage Audit & Cleanup (Super Admin) */}
          <div style={{ border: '1px solid var(--border)', borderRadius: '8px', padding: '1rem', background: 'var(--surface-muted, #fafafa)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ fontSize: '0.95rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ShieldCheck size={16} /> Orphan Asset Safety Audit (24h Age Guard)
                </h3>
                <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>
                  Detects abandoned uploads, deferred cloud deletions, and missing-cloud records older than 24 hours.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={orphanAuditMutation.isPending || orphanCleanupMutation.isPending}
                  onClick={() => orphanAuditMutation.mutate()}
                >
                  {orphanAuditMutation.isPending ? 'Scanning...' : 'Scan Orphans (Dry Run)'}
                </Button>
                {orphanReport &&
                  orphanReport.summary.pendingCloudDeletes +
                    orphanReport.summary.unregisteredCloudAssets +
                    orphanReport.summary.staleDbRecords >
                    0 && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={orphanCleanupMutation.isPending || orphanAuditMutation.isPending}
                      onClick={() => {
                        if (window.confirm('Clean up verified orphan storage assets older than 24 hours? Active CRM records will not be touched.')) {
                          orphanCleanupMutation.mutate()
                        }
                      }}
                    >
                      <Trash2 size={13} />
                      {orphanCleanupMutation.isPending ? 'Cleaning...' : 'Clean Verified Orphans'}
                    </Button>
                  )}
              </div>
            </div>

            {orphanError && (
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#e11d48' }}>{orphanError}</p>
            )}

            {orphanReport && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--muted)' }}>
                {orphanReport.dryRun ? 'Dry-run scan results' : 'Cleanup completed'}:{' '}
                <strong>{orphanReport.summary.pendingCloudDeletes}</strong> pending deletes,{' '}
                <strong>{orphanReport.summary.unregisteredCloudAssets}</strong> unregistered cloud uploads,{' '}
                <strong>{orphanReport.summary.staleDbRecords}</strong> stale DB references.
                {!orphanReport.dryRun && (
                  <span>
                    {' '}
                    Removed{' '}
                    <strong>
                      {orphanReport.summary.cleanedPendingCloudDeletes +
                        orphanReport.summary.cleanedUnregisteredCloudAssets}
                    </strong>{' '}
                    cloud objects and archived <strong>{orphanReport.summary.archivedStaleDbRecords}</strong> stale DB records.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

