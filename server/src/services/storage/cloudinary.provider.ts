import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary'
import { env } from '../../config/env.js'
import type {
  CloudResourceItem,
  IStorageProvider,
  PaginatedCloudResources,
  SignedUploadParams,
  UploadOptions,
  UploadResult,
  VerifiedAssetMetadata,
} from './storage.interface.js'
import { AppError } from '../../utils/errors.js'

export const DEFAULT_CLOUDINARY_LIST_MAX_PAGES = 100
export const DEFAULT_CLOUDINARY_LIST_MAX_RUNTIME_MS = 60_000

export class CloudinaryStorageProvider implements IStorageProvider {
  public readonly name = 'Cloudinary'

  constructor() {
    if (env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) {
      cloudinary.config({
        cloud_name: env.CLOUDINARY_CLOUD_NAME,
        api_key: env.CLOUDINARY_API_KEY,
        api_secret: env.CLOUDINARY_API_SECRET,
        secure: true,
      })
    }
  }

  private ensureConfigured() {
    if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
      throw new AppError(503, 'Cloudinary storage provider is not configured. Set CLOUDINARY_* environment variables.')
    }
  }

  async ping(): Promise<{ status: string; [key: string]: unknown }> {
    this.ensureConfigured()
    try {
      const res = await cloudinary.api.ping()
      return res as { status: string; [key: string]: unknown }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new AppError(503, `Cloudinary ping failed: ${msg}`)
    }
  }

  createSignedUploadParams(options: {
    publicId: string
    folder: string
    resourceType: 'image' | 'raw'
    tags: string[]
  }): SignedUploadParams {
    this.ensureConfigured()
    const timestamp = Math.floor(Date.now() / 1000)
    const tagsStr = options.tags.join(',')

    const paramsToSign: Record<string, string | number> = {
      public_id: options.publicId,
      tags: tagsStr,
      timestamp,
      type: 'authenticated',
    }

    const signature = cloudinary.utils.api_sign_request(paramsToSign, env.CLOUDINARY_API_SECRET!)

    return {
      mode: 'cloudinary',
      uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${options.resourceType}/upload`,
      cloudName: env.CLOUDINARY_CLOUD_NAME!,
      apiKey: env.CLOUDINARY_API_KEY!,
      timestamp,
      signature,
      publicId: options.publicId,
      resourceType: options.resourceType,
      folder: options.folder,
      tags: options.tags,
      type: 'authenticated',
    }
  }

  async getAssetMetadata(publicId: string, resourceType: string = 'image'): Promise<VerifiedAssetMetadata | null> {
    this.ensureConfigured()
    try {
      const res = (await cloudinary.api.resource(publicId, {
        resource_type: resourceType,
        type: 'authenticated',
      })) as {
        public_id: string
        resource_type: string
        format?: string
        bytes: number
        version?: number
        secure_url: string
        created_at?: string
        tags?: string[]
      }

      return {
        publicId: res.public_id,
        resourceType: res.resource_type,
        format: (res.format || '').toLowerCase(),
        bytes: Number(res.bytes || 0),
        version: res.version,
        secureUrl: res.secure_url,
        createdAt: res.created_at ? new Date(res.created_at) : undefined,
        tags: res.tags,
      }
    } catch (err: unknown) {
      const httpCode = (err as { error?: { http_code?: number }; http_code?: number })?.error?.http_code ??
        (err as { http_code?: number })?.http_code
      if (httpCode === 404) {
        return null
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new AppError(502, `Failed to verify asset with Cloudinary: ${msg}`)
    }
  }

  async listAllAssetsByPrefix(
    prefix: string,
    resourceType: 'image' | 'raw' = 'image',
    options?: { maxPages?: number; maxResults?: number; maxDurationMs?: number }
  ): Promise<PaginatedCloudResources> {
    this.ensureConfigured()
    const collected: CloudResourceItem[] = []
    const seenCursors = new Set<string>()
    let nextCursor: string | undefined
    let pagesFetched = 0
    let truncated = false
    let terminationReason: PaginatedCloudResources['terminationReason'] = 'COMPLETED'

    const maxPages = Math.max(options?.maxPages ?? DEFAULT_CLOUDINARY_LIST_MAX_PAGES, 1)
    const maxResults = Math.min(Math.max(options?.maxResults ?? 500, 1), 500)
    const maxDurationMs = Math.max(options?.maxDurationMs ?? DEFAULT_CLOUDINARY_LIST_MAX_RUNTIME_MS, 1)
    const startedAt = Date.now()

    while (true) {
      if (pagesFetched >= maxPages) {
        truncated = true
        terminationReason = 'MAX_PAGES'
        break
      }
      if (Date.now() - startedAt >= maxDurationMs) {
        truncated = true
        terminationReason = 'MAX_RUNTIME_MS'
        break
      }

      const res = (await cloudinary.api.resources({
        type: 'authenticated',
        resource_type: resourceType,
        prefix,
        max_results: maxResults,
        tags: true,
        ...(nextCursor ? { next_cursor: nextCursor } : {}),
      })) as {
        resources?: Array<{
          public_id: string
          resource_type: string
          type?: string
          bytes: number
          created_at: string
          tags?: string[]
        }>
        next_cursor?: string
      }

      pagesFetched += 1
      for (const item of res.resources ?? []) {
        collected.push({
          publicId: item.public_id,
          resourceType: item.resource_type,
          type: item.type || 'authenticated',
          bytes: Number(item.bytes || 0),
          createdAt: new Date(item.created_at),
          tags: item.tags,
        })
      }

      if (!res.next_cursor) {
        terminationReason = 'COMPLETED'
        break
      }
      if (seenCursors.has(res.next_cursor) || res.next_cursor === nextCursor) {
        truncated = true
        terminationReason = 'REPEATED_CURSOR'
        break
      }
      if (Date.now() - startedAt >= maxDurationMs) {
        truncated = true
        terminationReason = 'MAX_RUNTIME_MS'
        break
      }

      seenCursors.add(res.next_cursor)
      nextCursor = res.next_cursor
    }

    return { items: collected, truncated, pagesFetched, terminationReason }
  }

  async listAssetsByPrefix(prefix: string, resourceType: 'image' | 'raw' = 'image'): Promise<CloudResourceItem[]> {
    // Bounded to 5 pages (500 resources) for short-lived HTTP/cron contexts; full reconciliation uses listAllAssetsByPrefix.
    const result = await this.listAllAssetsByPrefix(prefix, resourceType, { maxPages: 5, maxResults: 100 })
    return result.items
  }

  async upload(options: UploadOptions): Promise<UploadResult> {
    this.ensureConfigured()

    return new Promise<UploadResult>((resolve, reject) => {
      const uploadOptions: Record<string, unknown> = {
        resource_type: options.resourceType,
        public_id: options.publicId,
        tags: options.tags,
        type: 'authenticated', // Private authenticated asset delivery by default
      }

      if (!options.publicId && options.folder) {
        uploadOptions.folder = options.folder
      }

      const stream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result: UploadApiResponse | undefined) => {
          if (error || !result) {
            return reject(new AppError(502, `Cloudinary upload failed: ${error?.message || 'Unknown error'}`))
          }
          resolve({
            publicId: result.public_id,
            secureUrl: result.secure_url,
            resourceType: result.resource_type,
            format: result.format,
            bytes: result.bytes,
            version: result.version,
          })
        }
      )

      stream.end(options.buffer)
    })
  }

  async delete(publicId: string, resourceType: string = 'image'): Promise<{ success: boolean; result?: string }> {
    this.ensureConfigured()
    try {
      const res = await cloudinary.uploader.destroy(publicId, {
        resource_type: resourceType,
        type: 'authenticated',
        invalidate: true,
      })
      const isOk = res.result === 'ok' || res.result === 'not found'
      return { success: isOk, result: res.result }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new AppError(502, `Cloudinary asset deletion failed: ${msg}`)
    }
  }

  async getSignedUrl(publicId: string, resourceType: string = 'image', expiresInSeconds: number = 3600): Promise<string> {
    this.ensureConfigured()

    const url = cloudinary.url(publicId, {
      resource_type: resourceType,
      type: 'authenticated',
      sign_url: true,
      secure: true,
      expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    })

    return url
  }
}
