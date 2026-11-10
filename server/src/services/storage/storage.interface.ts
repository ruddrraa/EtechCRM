export interface UploadOptions {
  buffer: Buffer
  filename: string
  mimeType: string
  resourceType: 'image' | 'raw' | 'video'
  folder: string
  publicId?: string
  tags?: string[]
}

export interface UploadResult {
  publicId: string
  secureUrl: string
  resourceType: string
  format?: string
  bytes: number
  version?: number
}

export interface SignedUploadParams {
  mode: 'cloudinary' | 'mock'
  uploadUrl?: string
  cloudName?: string
  apiKey?: string
  timestamp: number
  signature?: string
  publicId: string
  resourceType: 'image' | 'raw'
  folder: string
  tags: string[]
  type: 'authenticated'
}

export interface VerifiedAssetMetadata {
  publicId: string
  resourceType: string
  format: string
  bytes: number
  version?: number
  secureUrl: string
  createdAt?: Date
  tags?: string[]
}

export interface CloudResourceItem {
  publicId: string
  resourceType: string
  type?: string
  bytes: number
  createdAt: Date
  tags?: string[]
}

export type CloudListTerminationReason =
  | 'COMPLETED'
  | 'MAX_PAGES'
  | 'MAX_RUNTIME_MS'
  | 'REPEATED_CURSOR'
  | 'API_ERROR'

export interface PaginatedCloudResources {
  items: CloudResourceItem[]
  truncated: boolean
  pagesFetched: number
  terminationReason?: CloudListTerminationReason
}

export interface IStorageProvider {
  readonly name: string
  upload(options: UploadOptions): Promise<UploadResult>
  delete(publicId: string, resourceType?: string): Promise<{ success: boolean; result?: string }>
  getSignedUrl(publicId: string, resourceType?: string, expiresInSeconds?: number): Promise<string>
  ping?(): Promise<{ status: string; [key: string]: unknown }>
  createSignedUploadParams?(options: {
    publicId: string
    folder: string
    resourceType: 'image' | 'raw'
    tags: string[]
  }): SignedUploadParams
  getAssetMetadata?(publicId: string, resourceType: string): Promise<VerifiedAssetMetadata | null>
  listAssetsByPrefix?(prefix: string, resourceType: 'image' | 'raw'): Promise<CloudResourceItem[]>
  listAllAssetsByPrefix?(
    prefix: string,
    resourceType: 'image' | 'raw',
    options?: { maxPages?: number; maxResults?: number; maxDurationMs?: number }
  ): Promise<PaginatedCloudResources>
}
