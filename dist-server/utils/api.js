export function success(res, data, status = 200) {
    return res.status(status).json({ success: true, data });
}
export function failure(res, message, status = 400, details) {
    return res.status(status).json({ success: false, error: { message, ...(details ? { details } : {}) } });
}
