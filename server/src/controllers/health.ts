import type { Request, Response } from 'express'
import mongoose from 'mongoose'

const HEALTH_PING_TIMEOUT_MS = 2000

async function checkDatabaseReadiness(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    return false
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      mongoose.connection.db.admin().ping(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Database ping timeout')), HEALTH_PING_TIMEOUT_MS)
      }),
    ])
    return true
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function handleHealthCheck(req: Request, res: Response) {
  const isDbReady = await checkDatabaseReadiness()
  const timestamp = new Date().toISOString()

  if (!isDbReady) {
    return res.status(503).json({
      success: false,
      error: {
        message: 'Service temporarily unavailable',
        ...(req.requestId ? { requestId: req.requestId } : {}),
      },
      data: {
        status: 'degraded',
        database: 'disconnected',
        timestamp,
      },
    })
  }

  return res.status(200).json({
    success: true,
    data: {
      status: 'ok',
      database: 'connected',
      timestamp,
    },
  })
}

