import { useState, useRef, useEffect } from 'react'
import { UploadCloud, X, FileText, CheckCircle2, AlertCircle, RefreshCw, Eye, Download } from 'lucide-react'
import { Button } from './Button'
import { Modal } from './Modal'

function extractAssetId(url?: string | null): string | null {
  if (!url) return null
  const match = url.match(/\/api\/files\/([a-f0-9]{24})/i)
  return match ? match[1] : null
}

async function readFileHeaderHex(file: File): Promise<string> {
  const slice = file.slice(0, 16)
  const buffer = await slice.arrayBuffer()
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

interface FileUploadProps {
  ownerType: 'USER_AVATAR' | 'CLIENT_VISITING_CARD' | 'CLIENT_DOCUMENT' | 'VISIT_PHOTO' | 'VISIT_ATTACHMENT' | 'ORGANIZATION_EXPANDED_LOGO' | 'ORGANIZATION_COLLAPSED_LOGO' | 'GENERAL'
  ownerId: string
  assetId?: string
  label?: string
  description?: string
  accept?: string
  maxSizeBytes?: number
  currentUrl?: string
  currentName?: string
  onUploadSuccess?: (data: { asset: { _id: string; originalName: string; sizeBytes: number; mimeType: string }; viewUrl?: string; signedUrl: string }) => void
  onDeleteSuccess?: () => void
}

export function FileUpload({
  ownerType,
  ownerId,
  assetId,
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
  const [currentAssetId, setCurrentAssetId] = useState<string | null>(assetId || extractAssetId(currentUrl) || null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl || null)
  const [fileName, setFileName] = useState<string | null>(currentName || null)
  const [isViewerOpen, setIsViewerOpen] = useState(false)
  const [isViewerLoading, setIsViewerLoading] = useState(true)
  const [viewerError, setViewerError] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (assetId) {
      setCurrentAssetId(assetId)
    } else if (currentUrl) {
      const extracted = extractAssetId(currentUrl)
      if (extracted) setCurrentAssetId(extracted)
    }
    if (currentUrl) setPreviewUrl(currentUrl)
    if (currentName) setFileName(currentName)
  }, [assetId, currentUrl, currentName])

  const handleFile = async (file: File) => {
    setError(null)

    // Pre-upload validation: empty or oversized
    if (file.size <= 0) {
      setError('Cannot upload an empty file')
      return
    }
    if (file.size > maxSizeBytes) {
      const maxMb = Math.round(maxSizeBytes / (1024 * 1024))
      setError(`File size (${(file.size / (1024 * 1024)).toFixed(1)}MB) exceeds the maximum limit of ${maxMb}MB`)
      return
    }

    setIsUploading(true)

    try {
      const headerHex = await readFileHeaderHex(file)
      const mimeType = file.type || 'application/octet-stream'

      // 1. Obtain short-lived backend upload intent + Cloudinary signed upload params
      const signResponse = await fetch('/api/files/sign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ownerType,
          ownerId,
          originalName: file.name,
          mimeType,
          sizeBytes: file.size,
          headerHex,
        }),
      })

      const signJson = await signResponse.json()
      if (!signResponse.ok || !signJson.success) {
        throw new Error(signJson.error?.message || 'Failed to authorize file upload')
      }

      const { uploadIntentToken, uploadParams } = signJson.data as {
        uploadIntentToken: string
        uploadParams: {
          mode: 'cloudinary' | 'mock'
          uploadUrl?: string
          apiKey?: string
          timestamp: number
          signature?: string
          publicId: string
          tags: string[]
          type: 'authenticated'
        }
      }

      let resultData: {
        asset: { _id: string; originalName: string; sizeBytes: number; mimeType: string }
        viewUrl?: string
        signedUrl: string
      }

      if (uploadParams.mode === 'cloudinary' && uploadParams.uploadUrl && uploadParams.apiKey && uploadParams.signature) {
        // 2a. Direct browser-to-Cloudinary upload (bypasses Vercel serverless 4.5MB body ceiling)
        const cloudForm = new FormData()
        cloudForm.append('file', file)
        cloudForm.append('api_key', uploadParams.apiKey)
        cloudForm.append('timestamp', String(uploadParams.timestamp))
        cloudForm.append('signature', uploadParams.signature)
        cloudForm.append('public_id', uploadParams.publicId)
        cloudForm.append('tags', (uploadParams.tags || []).join(','))
        cloudForm.append('type', uploadParams.type || 'authenticated')

        const cloudResponse = await fetch(uploadParams.uploadUrl, {
          method: 'POST',
          body: cloudForm,
        })

        const cloudJson = await cloudResponse.json().catch(() => ({}))
        if (!cloudResponse.ok) {
          throw new Error(cloudJson.error?.message || 'Direct cloud upload failed')
        }

        // 3a. Server-side asset verification & MongoDB registration
        const registerResponse = await fetch('/api/files/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            uploadIntentToken,
            visibility: 'PRIVATE',
          }),
        })

        const registerJson = await registerResponse.json()
        if (!registerResponse.ok || !registerJson.success) {
          throw new Error(registerJson.error?.message || 'Uploaded file verification failed')
        }

        resultData = registerJson.data
      } else {
        // 2b. Mock storage mode fallback (no external Cloudinary endpoint available)
        const formData = new FormData()
        formData.append('file', file)
        formData.append('ownerType', ownerType)
        formData.append('ownerId', ownerId)
        formData.append('visibility', 'PRIVATE')

        const response = await fetch('/api/files/upload', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        })

        const json = await response.json()
        if (!response.ok || !json.success) {
          throw new Error(json.error?.message || 'File upload failed')
        }

        resultData = json.data
      }

      setFileName(file.name)
      if (resultData.asset?._id) {
        setCurrentAssetId(resultData.asset._id)
        setPreviewUrl(`/api/files/${resultData.asset._id}/view`)
      } else {
        setPreviewUrl(resultData.viewUrl || resultData.signedUrl)
      }

      onUploadSuccess?.(resultData)
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

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to remove this file?')) return
    setError(null)
    if (currentAssetId) {
      try {
        const res = await fetch(`/api/files/${currentAssetId}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (!res.ok && res.status !== 404) {
          const json = await res.json().catch(() => ({}))
          throw new Error(json.error?.message || 'Failed to delete file')
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        return
      }
    }
    setCurrentAssetId(null)
    setPreviewUrl(null)
    setFileName(null)
    onDeleteSuccess?.()
  }

  const isMockUrl = previewUrl ? previewUrl.includes('mock-storage.local') : false
  const crmViewUrl = currentAssetId ? `/api/files/${currentAssetId}/view` : (previewUrl?.startsWith('/api/files/') ? previewUrl : null)
  const isPdf = Boolean(fileName?.toLowerCase().endsWith('.pdf') || previewUrl?.toLowerCase().includes('.pdf'))
  const isImage = !isMockUrl && !isPdf && (crmViewUrl || (previewUrl && (previewUrl.includes('.jpg') || previewUrl.includes('.jpeg') || previewUrl.includes('.png') || previewUrl.includes('.webp') || previewUrl.includes('image'))))

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
          <span>Local legacy file detected. Please click <strong>Replace</strong> below to upload to cloud storage.</span>
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
            flexWrap: 'wrap',
            background: 'var(--surface)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: '180px', flex: 1 }}>
            {isImage ? (
              <img
                src={previewUrl}
                alt="Preview"
                style={{
                  width: '44px',
                  height: '44px',
                  minWidth: '44px',
                  minHeight: '44px',
                  flexShrink: 0,
                  objectFit: 'cover',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                }}
              />
            ) : (
              <div
                style={{
                  width: '44px',
                  height: '44px',
                  minWidth: '44px',
                  minHeight: '44px',
                  flexShrink: 0,
                  borderRadius: '6px',
                  background: isMockUrl ? '#fef3c7' : 'var(--surface-muted, #f3f4f6)',
                  display: 'grid',
                  placeItems: 'center',
                  color: isMockUrl ? '#b45309' : 'var(--muted)',
                }}
              >
                {isMockUrl ? <AlertCircle size={20} /> : <FileText size={20} />}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileName || (isMockUrl ? 'Local legacy file' : 'Attached file')}
              </span>
              {isMockUrl ? (
                <span style={{ fontSize: '0.75rem', color: '#d97706', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <AlertCircle size={12} style={{ flexShrink: 0 }} /> Local test file (Needs replacement)
                </span>
              ) : (
                <span style={{ fontSize: '0.75rem', color: '#16a34a', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <CheckCircle2 size={12} style={{ flexShrink: 0 }} /> Securely uploaded
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
            {isMockUrl ? (
              <button
                type="button"
                onClick={() => alert('This file was saved in local temporary storage and is not reachable on the network. Please click "Replace" to upload the file to cloud storage.')}
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
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setIsViewerLoading(true)
                  setViewerError(false)
                  setIsViewerOpen(true)
                }}
                title="View inside CRM"
              >
                <Eye size={13} /> View
              </Button>
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
              onClick={() => void handleDelete()}
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

      {/* CRM File Preview Modal */}
      {isViewerOpen && (
        <Modal title={`File Preview: ${fileName || 'Attached file'}`} onClose={() => setIsViewerOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {isImage ? (
              <div style={{ textAlign: 'center', padding: '1rem', background: 'var(--surface-muted, #f8fafc)', borderRadius: '8px', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isViewerLoading && (
                  <div style={{ fontSize: '0.875rem', color: 'var(--muted)', padding: '2rem' }}>
                    Loading file preview...
                  </div>
                )}
                <img
                  src={crmViewUrl || previewUrl || ''}
                  alt={fileName || 'Preview'}
                  onLoad={() => setIsViewerLoading(false)}
                  onError={() => {
                    setIsViewerLoading(false)
                    setViewerError(true)
                  }}
                  style={{
                    display: isViewerLoading ? 'none' : 'block',
                    maxWidth: '100%',
                    maxHeight: '60vh',
                    objectFit: 'contain',
                    borderRadius: '6px',
                  }}
                />
                {viewerError && (
                  <div style={{ color: '#e11d48', padding: '1.5rem', textAlign: 'center' }}>
                    <AlertCircle size={24} style={{ margin: '0 auto 8px' }} />
                    <p style={{ margin: 0, fontSize: '0.875rem' }}>Failed to load preview. Please use the Download button below.</p>
                  </div>
                )}
              </div>
            ) : isPdf ? (
              <iframe
                src={crmViewUrl || previewUrl || ''}
                title={fileName || 'Document Preview'}
                style={{ width: '100%', height: '60vh', border: '1px solid var(--border)', borderRadius: '6px' }}
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '2.5rem 1rem', background: 'var(--surface-muted, #f8fafc)', borderRadius: '8px' }}>
                <FileText size={44} style={{ color: 'var(--muted)', margin: '0 auto 10px' }} />
                <p style={{ fontWeight: 500, margin: '0 0 4px', fontSize: '0.9rem' }}>{fileName || 'Document'}</p>
                <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
                  In-browser preview is not available for this format. Click Download below to view.
                </span>
              </div>
            )}

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
              {crmViewUrl && (
                <a
                  href={`${crmViewUrl}?download=1`}
                  download={fileName || 'download'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    borderRadius: '6px',
                    background: 'var(--primary, #dc2626)',
                    color: '#ffffff',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  <Download size={15} /> Download
                </a>
              )}
              <Button variant="secondary" onClick={() => setIsViewerOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

