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

export interface IStorageProvider {
  readonly name: string
  upload(options: UploadOptions): Promise<UploadResult>
  delete(publicId: string, resourceType?: string): Promise<{ success: boolean; result?: string }>
  getSignedUrl(publicId: string, resourceType?: string, expiresInSeconds?: number): Promise<string>
  ping?(): Promise<{ status: string; [key: string]: unknown }>
}

