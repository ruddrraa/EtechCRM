import type { IStorageProvider, UploadOptions, UploadResult } from './storage.interface.js'

export class MockStorageProvider implements IStorageProvider {
  public readonly name = 'MockStorage'
  public storedFiles = new Map<string, { buffer: Buffer; options: UploadOptions; uploadedAt: Date }>()
  public shouldFailUpload = false
  public shouldFailDelete = false

  async ping(): Promise<{ status: string; [key: string]: unknown }> {
    return { status: 'ok', mock: true }
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
  }
}

