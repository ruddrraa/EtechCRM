import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from '../server/src/app.js'
import { connectDatabase } from '../server/src/config/db.js'

type ServerlessApp = ReturnType<typeof createApp>

const globalForServerless = globalThis as typeof globalThis & {
  __etechServerlessApp?: ServerlessApp
}

export function getServerlessApp(): ServerlessApp {
  if (!globalForServerless.__etechServerlessApp) {
    globalForServerless.__etechServerlessApp = createApp()
  }
  return globalForServerless.__etechServerlessApp
}

function sanitizeDbError(message: string): string {
  return message.replace(/mongodb(\+srv)?:\/\/[^@\s]+@/gi, 'mongodb$1://***@')
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await connectDatabase()
    const app = getServerlessApp()
    await new Promise<void>((resolve) => {
      let settled = false
      const done = () => {
        if (!settled) {
          settled = true
          resolve()
        }
      }
      res.once('finish', done)
      res.once('close', done)
      app(req as Parameters<ServerlessApp>[0], res as Parameters<ServerlessApp>[1])
      if (res.writableEnded) {
        done()
      }
    })
  } catch (error) {
    const rawMsg = error instanceof Error ? error.message : 'Initialization failed'
    console.error('[Vercel API] Initialization error:', sanitizeDbError(rawMsg))
    if (!res.headersSent) {
      res.statusCode = 503
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
      res.end(
        JSON.stringify({
          success: false,
          error: { message: 'Service temporarily unavailable. Please try again shortly.' },
        })
      )
    }
  }
}
