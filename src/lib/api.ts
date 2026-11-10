export const DEFAULT_API_TIMEOUT_MS = 15_000

export type ApiErrorCode = 'TIMEOUT' | 'ABORTED' | 'NETWORK' | 'HTTP'

export type ApiError = Error & {
  status?: number
  code?: ApiErrorCode
  requestId?: string
  isTimeout?: boolean
}

type UnauthorizedListener = () => void
const unauthorizedListeners = new Set<UnauthorizedListener>()

export function onUnauthorizedResponse(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener)
  return () => {
    unauthorizedListeners.delete(listener)
  }
}

function notifyUnauthorized() {
  unauthorizedListeners.forEach((listener) => {
    try {
      listener()
    } catch {
      // Ignore subscriber errors
    }
  })
}

export type ApiFetchOptions = RequestInit & {
  timeoutMs?: number
}

export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, signal: externalSignal, ...fetchOptions } = options

  const controller = new AbortController()
  let didTimeout = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason)
  }

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
  }

  if (timeoutMs > 0 && !controller.signal.aborted) {
    timer = setTimeout(() => {
      didTimeout = true
      controller.abort(new Error('Request timeout'))
    }, timeoutMs)
  }

  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData

  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...fetchOptions,
      credentials: fetchOptions.credentials ?? 'include',
      signal: controller.signal,
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...fetchOptions.headers,
      },
    })
  } catch (err: unknown) {
    if (timer) clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)

    if (didTimeout) {
      const timeoutErr = new Error('Request timed out. Please check your connection and try again.') as ApiError
      timeoutErr.name = 'TimeoutError'
      timeoutErr.code = 'TIMEOUT'
      timeoutErr.isTimeout = true
      throw timeoutErr
    }

    if (externalSignal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      const abortErr = new Error('Request was cancelled') as ApiError
      abortErr.name = 'AbortError'
      abortErr.code = 'ABORTED'
      throw abortErr
    }

    const networkErr = new Error('Unable to reach the server. Please check your internet connection.') as ApiError
    networkErr.name = 'NetworkError'
    networkErr.code = 'NETWORK'
    throw networkErr
  } finally {
    if (timer) clearTimeout(timer)
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const normalizedPath = path.split('?')[0]
    const isAuthLifecycleEndpoint =
      normalizedPath === '/auth/me' ||
      normalizedPath === '/auth/login' ||
      normalizedPath === '/auth/logout' ||
      normalizedPath === '/auth/bootstrap'

    if (response.status === 401 && !isAuthLifecycleEndpoint) {
      notifyUnauthorized()
    }

    const error = new Error(body?.error?.message ?? 'Request failed') as ApiError
    error.status = response.status
    error.code = 'HTTP'
    error.requestId = body?.error?.requestId ?? response.headers?.get('X-Request-Id') ?? undefined
    throw error
  }

  return body.data as T
}
