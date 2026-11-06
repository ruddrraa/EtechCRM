import { ZodError } from 'zod';
import { failure } from '../utils/api.js';
import { AppError } from '../utils/errors.js';
export const errorHandler = (error, _req, res, next) => {
    void next;
    if (error instanceof ZodError)
        return failure(res, 'Validation failed', 422, error.flatten());
    if (error instanceof AppError)
        return failure(res, error.message, error.statusCode, error.details);
    if (error?.code === 11000)
        return failure(res, 'A record with that value already exists', 409);
    console.error(error);
    return failure(res, 'Internal server error', 500);
};
