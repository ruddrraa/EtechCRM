import { User } from '../models/User.js'

export function migrateLegacyRoles() {
  return Promise.all([
    User.updateMany({ role: 'ADMIN' }, { $set: { role: 'MARKETING_HEAD', reportingTo: null }, $inc: { tokenVersion: 1 } }),
    User.updateMany({ role: 'USER' }, { $set: { role: 'MARKETING_EXECUTIVE', reportingTo: null }, $inc: { tokenVersion: 1 } }),
  ]).then(() => undefined)
}
