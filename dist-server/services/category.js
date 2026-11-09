import { Category } from '../models/Category.js';
import { Client } from '../models/Client.js';
import { AppError } from '../utils/errors.js';
import { recordAudit } from './audit.js';
export async function listCategories(user, query) {
    const isSuperAdmin = user.role === 'SUPER_ADMIN';
    const filter = {};
    if (!isSuperAdmin || query.activeOnly === 'true') {
        filter.isActive = true;
    }
    if (query.q) {
        filter.name = { $regex: query.q.trim(), $options: 'i' };
    }
    const items = await Category.find(filter)
        .sort({ name: 1 })
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .lean();
    return items;
}
export async function createCategory(input, actor) {
    const normalizedName = input.name.trim().toLowerCase();
    const existing = await Category.findOne({ normalizedName });
    if (existing) {
        throw new AppError(409, `Category "${existing.name}" already exists`);
    }
    const category = await Category.create({
        name: input.name.trim(),
        normalizedName,
        isActive: true,
        createdBy: actor,
    });
    await recordAudit(actor, 'CATEGORY_CREATED', 'Category', String(category._id), { name: category.name });
    return category;
}
export async function updateCategory(id, input, actor) {
    const category = await Category.findById(id);
    if (!category) {
        throw new AppError(404, 'Category not found');
    }
    const updates = { updatedBy: actor };
    if (input.name !== undefined) {
        const trimmed = input.name.trim();
        const normalizedName = trimmed.toLowerCase();
        if (normalizedName !== category.normalizedName) {
            const duplicate = await Category.findOne({ normalizedName, _id: { $ne: id } });
            if (duplicate) {
                throw new AppError(409, `Category "${duplicate.name}" already exists`);
            }
            updates.name = trimmed;
            updates.normalizedName = normalizedName;
        }
    }
    if (input.isActive !== undefined) {
        updates.isActive = input.isActive;
    }
    const updated = await Category.findByIdAndUpdate(id, { $set: updates }, { new: true, runValidators: true });
    await recordAudit(actor, 'CATEGORY_UPDATED', 'Category', id, updates);
    return updated;
}
export async function deleteCategory(id, actor) {
    const category = await Category.findById(id);
    if (!category) {
        throw new AppError(404, 'Category not found');
    }
    const clientReferencing = await Client.findOne({
        $or: [
            { categoryId: category._id },
            { category: { $regex: `^${category.name.trim()}$`, $options: 'i' } },
        ],
    }).select('_id organisationName').lean();
    if (clientReferencing) {
        throw new AppError(400, `Cannot delete category "${category.name}" because it is referenced by client "${clientReferencing.organisationName}"`);
    }
    await Category.findByIdAndDelete(id);
    await recordAudit(actor, 'CATEGORY_DELETED', 'Category', id, { name: category.name });
    return { message: 'Category deleted successfully' };
}
