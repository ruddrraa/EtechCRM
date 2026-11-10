import type {
  CloudResourceItem,
  IStorageProvider,
  PaginatedCloudResources,
  SignedUploadParams,
  UploadOptions,
  UploadResult,
  VerifiedAssetMetadata,
} from './storage.interface.js'

export class MockStorageProvider implements IStorageProvider {
  public readonly name = 'MockStorage'
  public storedFiles = new Map<string, { buffer: Buffer; options: UploadOptions; uploadedAt: Date }>()
  public shouldFailUpload = false
  public shouldFailDelete = false
  public shouldFailListAfterPages: number | null = null
  public simulateRepeatedCursor = false
  public simulatedPageDelayMs = 0
  public listPageSizeForTests = 100

  async ping(): Promise<{ status: string; [key: string]: unknown }> {
    return { status: 'ok', mock: true }
  }

  createSignedUploadParams(options: {
    publicId: string
    folder: string
    resourceType: 'image' | 'raw'
    tags: string[]
  }): SignedUploadParams {
    return {
      mode: 'mock',
      timestamp: Math.floor(Date.now() / 1000),
      publicId: options.publicId,
      resourceType: options.resourceType,
      folder: options.folder,
      tags: options.tags,
      type: 'authenticated',
    }
  }

  async getAssetMetadata(publicId: string, resourceType: string): Promise<VerifiedAssetMetadata | null> {
    const entry = this.storedFiles.get(publicId)
    if (!entry) return null
    const ext = entry.options.filename.split('.').pop()?.toLowerCase() || ''
    return {
      publicId,
      resourceType: entry.options.resourceType || resourceType,
      format: ext,
      bytes: entry.buffer.length,
      version: 1,
      secureUrl: `https://mock-storage.local/${publicId}`,
      createdAt: entry.uploadedAt,
      tags: entry.options.tags,
    }
  }

  async listAllAssetsByPrefix(
    prefix: string,
    resourceType: 'image' | 'raw',
    options?: { maxPages?: number; maxResults?: number; maxDurationMs?: number }
  ): Promise<PaginatedCloudResources> {
    const matching: CloudResourceItem[] = []
    for (const [publicId, entry] of this.storedFiles.entries()) {
      if (publicId.startsWith(prefix) && entry.options.resourceType === resourceType) {
        matching.push({
          publicId,
          resourceType: entry.options.resourceType,
          type: 'authenticated',
          bytes: entry.buffer.length,
          createdAt: entry.uploadedAt,
          tags: entry.options.tags,
        })
      }
    }

    const pageSize = Math.max(options?.maxResults ?? this.listPageSizeForTests, 1)
    const maxPages = typeof options?.maxPages === 'number' ? Math.max(options.maxPages, 1) : undefined
    const maxDurationMs = typeof options?.maxDurationMs === 'number' ? Math.max(options.maxDurationMs, 1) : undefined
    const collected: CloudResourceItem[] = []
    const seenCursors = new Set<string>()
    let pagesFetched = 0
    let truncated = false
    let terminationReason: PaginatedCloudResources['terminationReason'] = 'COMPLETED'
    const startedAt = Date.now()
    let prevCursor: string | undefined

    for (let offset = 0; offset < matching.length || pagesFetched === 0; offset += pageSize) {
      if (typeof maxPages === 'number' && pagesFetched >= maxPages) {
        truncated = true
        terminationReason = 'MAX_PAGES'
        break
      }
      if (typeof maxDurationMs === 'number' && Date.now() - startedAt >= maxDurationMs) {
        truncated = true
        terminationReason = 'MAX_RUNTIME_MS'
        break
      }
      if (this.shouldFailListAfterPages !== null && pagesFetched >= this.shouldFailListAfterPages) {
        throw new Error('Simulated cloud listing pagination failure')
      }
      if (this.simulatedPageDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.simulatedPageDelayMs))
      }

      pagesFetched += 1
      collected.push(...matching.slice(offset, offset + pageSize))

      if (this.simulateRepeatedCursor) {
        const fakeCursor = 'cursor_stuck_repeat'
        if (seenCursors.has(fakeCursor) || fakeCursor === prevCursor) {
          truncated = true
          terminationReason = 'REPEATED_CURSOR'
          break
        }
        seenCursors.add(fakeCursor)
        prevCursor = fakeCursor
      }

      if (offset + pageSize >= matching.length && !this.simulateRepeatedCursor) break
      if (typeof maxDurationMs === 'number' && Date.now() - startedAt >= maxDurationMs) {
        truncated = true
        terminationReason = 'MAX_RUNTIME_MS'
        break
      }
    }

    return { items: collected, truncated, pagesFetched, terminationReason }
  }

  async listAssetsByPrefix(prefix: string, resourceType: 'image' | 'raw'): Promise<CloudResourceItem[]> {
    const result = await this.listAllAssetsByPrefix(prefix, resourceType)
    return result.items
  }

  async upload(options: UploadOptions): Promise<UploadResult> {
    if (this.shouldFailUpload) {
      throw new Error('Simulated storage provider upload error')
    }

    const publicId = options.publicId || `${options.folder}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    this.storedFiles.set(publicId, {
      buffer: options.buffer,
      options,
      uploadedAt: new Date(),
    })

    return {
      publicId,
      secureUrl: `https://mock-storage.local/${publicId}`,
      resourceType: options.resourceType,
      format: options.filename.split('.').pop() || 'bin',
      bytes: options.buffer.length,
      version: 1,
    }
  }

  async delete(publicId: string): Promise<{ success: boolean; result?: string }> {
    if (this.shouldFailDelete) {
      throw new Error('Simulated storage provider delete error')
    }

    const existed = this.storedFiles.delete(publicId)
    return { success: existed, result: existed ? 'ok' : 'not found' }
  }

  async getSignedUrl(publicId: string, _resourceType?: string, expiresInSeconds: number = 3600): Promise<string> {
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds
    return `https://mock-storage.local/${publicId}?expires=${expiresAt}&signature=mock_sig_${publicId.replace(/\//g, '_')}`
  }

  clear(): void {
    this.storedFiles.clear()
    this.shouldFailUpload = false
    this.shouldFailDelete = false
    this.shouldFailListAfterPages = null
    this.simulateRepeatedCursor = false
    this.simulatedPageDelayMs = 0
    this.listPageSizeForTests = 100
  }
}
