export type ApiError = Error & { status?: number }

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(body?.error?.message ?? 'Request failed') as ApiError
    error.status = response.status
    throw error
  }
  return body.data as T
}
