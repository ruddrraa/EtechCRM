import type { ErrorRequestHandler, Response } from 'express'
import mongoose from 'mongoose'
import { MulterError } from 'multer'
import { ZodError } from 'zod'
import { AppError } from '../utils/errors.js'

export function maskSensitiveText(value: string): string {
  return value
    .replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://***@')
    .replace(/cloudinary:\/\/[^@\s]+@/gi, 'cloudinary://***@')
    .replace(/([?&](?:api_key|api_secret|token|password|cron_secret)=)[^&\s]+/gi, '$1***')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1***')
}

function sendErrorResponse(
  res: Response,
  message: string,
  status: number,
  requestId?: string,
  details?: unknown
) {
  return res.status(status).json({
    success: false,
    error: {
      message,
      ...(requestId ? { requestId } : {}),
      ...(details !== undefined ? { details } : {}),
    },
  })
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  void next
  const requestId = req.requestId
  if (error instanceof ZodError) {
    return sendErrorResponse(res, 'Validation failed', 422, requestId, error.flatten())
  }
  if (error instanceof AppError) {
    return sendErrorResponse(res, error.message, error.statusCode, requestId, error.details)
  }
  if (error instanceof mongoose.Error.CastError) {
    return sendErrorResponse(res, 'Invalid identifier format', 422, requestId)
  }
  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return sendErrorResponse(res, 'Uploaded file exceeds the maximum allowed payload size', 413, requestId)
    }
    return sendErrorResponse(res, error.message || 'Invalid upload payload', 400, requestId)
  }
  if (error?.type === 'entity.too.large') {
    return sendErrorResponse(res, 'Request payload exceeds the 1MB limit', 413, requestId)
  }
  if (error?.code === 11000) {
    return sendErrorResponse(res, 'A record with that value already exists', 409, requestId)
  }

  const safeMsg = maskSensitiveText(error instanceof Error ? error.message : 'Unknown error')
  console.error('[API Error]', {
    requestId,
    method: req.method,
    path: req.path,
    name: error?.name,
    message: safeMsg,
  })
  return sendErrorResponse(res, 'Internal server error', 500, requestId)
}
