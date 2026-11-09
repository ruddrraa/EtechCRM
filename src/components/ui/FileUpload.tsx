import { useState, useRef } from 'react'
import { UploadCloud, X, FileText, CheckCircle2, AlertCircle, RefreshCw, Eye } from 'lucide-react'
import { Button } from './Button'

interface FileUploadProps {
  ownerType: 'USER_AVATAR' | 'CLIENT_VISITING_CARD' | 'CLIENT_DOCUMENT' | 'VISIT_PHOTO' | 'VISIT_ATTACHMENT' | 'GENERAL'
  ownerId: string
  label?: string
  description?: string
  accept?: string
  maxSizeBytes?: number
  currentUrl?: string
  currentName?: string
  onUploadSuccess?: (data: { asset: { _id: string; originalName: string; sizeBytes: number; mimeType: string }; signedUrl: string }) => void
  onDeleteSuccess?: () => void
}

export function FileUpload({
  ownerType,
  ownerId,
  label = 'Upload file',
  description = 'Drag & drop or click to select',
  accept = 'image/*,application/pdf',
  maxSizeBytes = 10 * 1024 * 1024,
  currentUrl,
  currentName,
  onUploadSuccess,
  onDeleteSuccess,
}: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl || null)
  const [fileName, setFileName] = useState<string | null>(currentName || null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError(null)

    // Pre-upload validation: size
    if (file.size > maxSizeBytes) {
      const maxMb = Math.round(maxSizeBytes / (1024 * 1024))
      setError(`File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds the maximum limit of ${maxMb}MB`)
      return
    }

    setIsUploading(true)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('ownerType', ownerType)
    formData.append('ownerId', ownerId)
    formData.append('visibility', 'PRIVATE')

    try {
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      const json = await response.json()

      if (!response.ok || !json.success) {
        throw new Error(json.error?.message || 'File upload failed')
      }

      setFileName(file.name)
      if (file.type.startsWith('image/')) {
        setPreviewUrl(json.data.signedUrl || URL.createObjectURL(file))
      } else {
        setPreviewUrl(json.data.signedUrl)
      }

      onUploadSuccess?.(json.data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    } finally {
      setIsUploading(false)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFile(e.dataTransfer.files[0])
    }
  }

  const handleDelete = () => {
    if (!window.confirm('Are you sure you want to remove this file?')) return
    setPreviewUrl(null)
    setFileName(null)
    setError(null)
    onDeleteSuccess?.()
  }

  const isMockUrl = previewUrl ? previewUrl.includes('mock-storage.local') : false
  const isImage = !isMockUrl && previewUrl && (previewUrl.includes('.jpg') || previewUrl.includes('.jpeg') || previewUrl.includes('.png') || previewUrl.includes('.webp') || previewUrl.includes('image'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
      {label && <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>{label}</span>}

      {isMockUrl && (
        <div
          style={{
            fontSize: '0.75rem',
            color: '#b45309',
            background: '#fef3c7',
            border: '1px solid #fde68a',
            padding: '6px 10px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <AlertCircle size={14} style={{ flexShrink: 0 }} />
          <span>Local mock asset detected. Please click <strong>Replace</strong> below to upload to Cloudinary.</span>
        </div>
      )}

      {previewUrl ? (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.75rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
            {isImage ? (
              <img
                src={previewUrl}
                alt="Preview"
                style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--border)' }}
              />
            ) : (
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '6px',
                  background: isMockUrl ? '#fef3c7' : 'var(--surface-muted, #f3f4f6)',
                  display: 'grid',
                  placeItems: 'center',
                  color: isMockUrl ? '#b45309' : 'var(--muted)',
                }}
              >
                {isMockUrl ? <AlertCircle size={24} /> : <FileText size={24} />}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileName || (isMockUrl ? 'Local mock file' : 'Attached file')}
              </span>
              {isMockUrl ? (
                <span style={{ fontSize: '0.75rem', color: '#d97706', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <AlertCircle size={12} /> Local test file (Needs replacement)
                </span>
              ) : (
                <span style={{ fontSize: '0.75rem', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <CheckCircle2 size={12} /> Securely uploaded
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
            {isMockUrl ? (
              <button
                type="button"
                onClick={() => alert('This file was saved in local mock storage before Cloudinary was configured and is not reachable on the network. Please click "Replace" to upload the file to Cloudinary.')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '6px 10px',
                  fontSize: '0.75rem',
                  border: '1px solid #fde68a',
                  borderRadius: '4px',
                  color: '#b45309',
                  background: '#fef3c7',
                  cursor: 'pointer',
                }}
                title="Mock file is not reachable"
              >
                <Eye size={13} /> View
              </button>
            ) : (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '6px 10px',
                  fontSize: '0.75rem',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  color: 'var(--foreground)',
                  textDecoration: 'none',
                }}
                title="View full file"
              >
                <Eye size={13} /> View
              </a>
            )}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              title="Replace file"
            >
              <RefreshCw size={13} /> Replace
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={handleDelete}
              title="Delete file"
            >
              <X size={14} />
            </Button>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${isDragging ? 'var(--primary, #2563eb)' : 'var(--border)'}`,
            borderRadius: '8px',
            padding: '1.25rem 1rem',
            textAlign: 'center',
            cursor: isUploading ? 'not-allowed' : 'pointer',
            backgroundColor: isDragging ? 'var(--surface-muted, #f9fafb)' : 'transparent',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' }}>
            <UploadCloud size={24} style={{ color: isDragging ? 'var(--primary, #2563eb)' : 'var(--muted)' }} />
            <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>
              {isUploading ? 'Uploading file to secure cloud storage...' : description}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              Max size: {Math.round(maxSizeBytes / (1024 * 1024))}MB
            </span>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) {
            void handleFile(e.target.files[0])
          }
        }}
        style={{ display: 'none' }}
      />

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: '#e11d48', fontSize: '0.75rem', marginTop: '0.25rem' }}>
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

