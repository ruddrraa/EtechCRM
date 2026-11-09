import { useQuery } from '@tanstack/react-query'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { apiFetch } from '../../lib/api'
import { HardDrive, FileCheck, Layers, Clock, Cloud } from 'lucide-react'

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
  const { data: stats, isLoading, isError } = useQuery<StorageStats>({
    queryKey: ['settings', 'storageDashboard'],
    queryFn: () => apiFetch<StorageStats>('/files/storage/dashboard'),
    staleTime: 30000,
  })

  return (
    <Card>
      <div className="section-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <HardDrive size={22} className="text-primary" />
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0 }}>Cloud Storage &amp; Media Overview</h2>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--muted)' }}>
              Centralized file asset metrics, storage usage and recent uploads.
            </p>
          </div>
        </div>

        {stats && (
          <Badge tone={stats.isLiveCloudinary ? 'success' : 'neutral'}>
            <Cloud size={12} style={{ marginRight: '4px', display: 'inline' }} />
            {stats.storageProvider} {stats.isLiveCloudinary ? '(Live Cloud)' : '(Dev Storage)'}
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
                * Aggregated from MongoDB asset metadata
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
                        <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)' }}>{new Date(file.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

