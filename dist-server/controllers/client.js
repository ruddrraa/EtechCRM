import { archiveClient, createClient, listClients, updateClient } from '../services/client.js';
import { success } from '../utils/api.js';
export async function getClients(req, res) {
    return success(res, await listClients({ q: typeof req.query.q === 'string' ? req.query.q : undefined, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20 }));
}
export async function postClient(req, res) {
    return success(res, await createClient(req.body, req.authUser.id), 201);
}
export async function patchClient(req, res) {
    return success(res, await updateClient(String(req.params.id), req.body, req.authUser.id));
}
export async function deleteClient(req, res) {
    return success(res, await archiveClient(String(req.params.id), req.authUser.id));
}
