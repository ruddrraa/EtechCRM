export class MockStorageProvider {
    name = 'MockStorage';
    storedFiles = new Map();
    shouldFailUpload = false;
    shouldFailDelete = false;
    async ping() {
        return { status: 'ok', mock: true };
    }
    async upload(options) {
        if (this.shouldFailUpload) {
            throw new Error('Simulated storage provider upload error');
        }
        const publicId = options.publicId || `${options.folder}/${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        this.storedFiles.set(publicId, {
            buffer: options.buffer,
            options,
            uploadedAt: new Date(),
        });
        return {
            publicId,
            secureUrl: `https://mock-storage.local/${publicId}`,
            resourceType: options.resourceType,
            format: options.filename.split('.').pop() || 'bin',
            bytes: options.buffer.length,
            version: 1,
        };
    }
    async delete(publicId) {
        if (this.shouldFailDelete) {
            throw new Error('Simulated storage provider delete error');
        }
        const existed = this.storedFiles.delete(publicId);
        return { success: existed, result: existed ? 'ok' : 'not found' };
    }
    async getSignedUrl(publicId, _resourceType, expiresInSeconds = 3600) {
        const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
        return `https://mock-storage.local/${publicId}?expires=${expiresAt}&signature=mock_sig_${publicId.replace(/\//g, '_')}`;
    }
    clear() {
        this.storedFiles.clear();
        this.shouldFailUpload = false;
        this.shouldFailDelete = false;
    }
}
