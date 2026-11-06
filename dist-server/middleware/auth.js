import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/errors.js';
export function isAllowedOrigin(origin) {
    if (origin === env.CLIENT_URL)
        return true;
    return env.NODE_ENV === 'development' && /^https?:\/\/(localhost|127\.0\.0\.1):517[34]$/.test(origin);
}
export async function requireAuth(req, _res, next) {
    try {
        const token = req.cookies?.accessToken;
        if (!token)
            throw new AppError(401, 'Authentication required');
        const payload = jwt.verify(token, env.JWT_SECRET);
        const user = await User.findOne({ _id: payload.id, isActive: true, isArchived: { $ne: true } }).select('_id role tokenVersion').lean();
        if (!user)
            throw new AppError(401, 'Session is no longer valid');
        const tokenVersion = user.tokenVersion ?? 0;
        if (payload.tokenVersion !== tokenVersion)
            throw new AppError(401, 'Session is no longer valid');
        req.authUser = { id: String(user._id), role: user.role, tokenVersion };
        next();
    }
    catch (error) {
        next(error instanceof AppError ? error : new AppError(401, 'Authentication required'));
    }
}
export function requireRoles(...allowed) {
    return (req, _res, next) => {
        if (!req.authUser || !allowed.includes(req.authUser.role))
            return next(new AppError(403, 'You do not have permission for this action'));
        next();
    };
}
export function requireSameOrigin(req, _res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method))
        return next();
    const origin = req.get('origin');
    if (origin && !isAllowedOrigin(origin))
        return next(new AppError(403, 'Origin is not allowed'));
    next();
}
export function isExecutiveRole(role) {
    return role === 'MARKETING_EXECUTIVE' || role === 'USER';
}
export function isHeadRole(role) {
    return role === 'MARKETING_HEAD' || role === 'ADMIN';
}
