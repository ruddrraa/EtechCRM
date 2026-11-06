import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';
export async function authenticate(email, password) {
    const user = await User.findOne({ email: email.toLowerCase(), isActive: true, isArchived: { $ne: true } }).select('+passwordHash');
    if (!user || !(await bcrypt.compare(password, user.passwordHash)))
        throw new AppError(401, 'Invalid email or password');
    return user;
}
export function tokenFor(userId, role, tokenVersion = 0) {
    return jwt.sign({ id: userId, role, tokenVersion }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN });
}
export function cookieOptions() {
    return { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000, path: '/' };
}
