import { User } from '../models/User.js'
import { Client } from '../models/Client.js'
import { Category } from '../models/Category.js'

export function migrateLegacyRoles() {
  return Promise.all([
    User.updateMany({ role: 'ADMIN' }, { $set: { role: 'MARKETING_HEAD', reportingTo: null }, $inc: { tokenVersion: 1 } }),
    User.updateMany({ role: 'USER' }, { $set: { role: 'MARKETING_EXECUTIVE', reportingTo: null }, $inc: { tokenVersion: 1 } }),
  ]).then(() => undefined)
}

export async function migrateCategories(adminId?: string) {
  // Find a fallback Super Admin for createdBy if adminId is not provided
  let defaultCreator = adminId
  if (!defaultCreator) {
    const adminUser = await User.findOne({ role: 'SUPER_ADMIN' }).select('_id').lean()
    defaultCreator = adminUser ? String(adminUser._id) : undefined
  }

  // Find all distinct non-empty category names from clients
  const clients = await Client.find({ category: { $exists: true, $ne: '' } }).select('_id category categoryId createdBy').lean()

  // Map to group by normalizedName
  const groupMap = new Map<string, { preferredName: string; clientIds: string[]; creatorId?: string }>()

  for (const client of clients) {
    const rawName = (client.category || '').trim()
    if (!rawName) continue
    const normalized = rawName.toLowerCase()

    if (!groupMap.has(normalized)) {
      groupMap.set(normalized, {
        preferredName: rawName,
        clientIds: [String(client._id)],
        creatorId: String(client.createdBy || defaultCreator),
      })
    } else {
      const entry = groupMap.get(normalized)!
      entry.clientIds.push(String(client._id))
    }
  }

  // Process each group idempotently
  for (const [normalized, data] of groupMap.entries()) {
    let category = await Category.findOne({ normalizedName: normalized })

    if (!category) {
      const creator = defaultCreator || data.creatorId
      if (!creator) {
        // Find any user or create category without creator ref if none exists
        const anyUser = await User.findOne({}).select('_id').lean()
        if (!anyUser) continue
        category = await Category.create({
          name: data.preferredName,
          normalizedName: normalized,
          isActive: true,
          createdBy: anyUser._id,
        })
      } else {
        category = await Category.create({
          name: data.preferredName,
          normalizedName: normalized,
          isActive: true,
          createdBy: creator,
        })
      }
    }

    // Link all clients in this group to the canonical category
    await Client.updateMany(
      { _id: { $in: data.clientIds } },
      { $set: { categoryId: category._id, category: category.name } },
    )
  }

  return { migratedGroups: groupMap.size }
}
