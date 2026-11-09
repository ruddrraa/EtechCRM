import mongoose from 'mongoose';
import { env } from './env.js';
import { migrateLegacyRoles } from '../services/migration.js';
let connectionPromise = null;
mongoose.connection.on('disconnected', () => {
    connectionPromise = null;
});
export function connectDatabase(uri) {
    const targetUri = uri || process.env.MONGODB_URI || env.MONGODB_URI;
    if (mongoose.connection.readyState === 1)
        return Promise.resolve(mongoose);
    connectionPromise ??= mongoose.connect(targetUri).then(async (connection) => {
        await migrateLegacyRoles();
        return connection;
    });
    return connectionPromise;
}
