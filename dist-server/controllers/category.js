import { createCategory, deleteCategory, listCategories, updateCategory } from '../services/category.js';
import { success } from '../utils/api.js';
export async function getCategories(req, res) {
    const result = await listCategories(req.authUser, {
        activeOnly: typeof req.query.activeOnly === 'string' ? req.query.activeOnly : undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
    });
    return success(res, result);
}
export async function postCategory(req, res) {
    const result = await createCategory(req.body, req.authUser.id);
    return success(res, result, 201);
}
export async function patchCategory(req, res) {
    const result = await updateCategory(String(req.params.id), req.body, req.authUser.id);
    return success(res, result);
}
export async function removeCategory(req, res) {
    const result = await deleteCategory(String(req.params.id), req.authUser.id);
    return success(res, result);
}
