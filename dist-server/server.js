import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { verifyStorageConnectivity } from './services/storage/storage.service.js';
await connectDatabase();
await verifyStorageConnectivity();
createApp().listen(env.PORT, '0.0.0.0', () => console.log(`API listening on port ${env.PORT}`));
