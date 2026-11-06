import { type ReactNode, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'
import type { AuthUser } from '../../types'
import { AuthContext } from './AuthContext'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const userQuery = useQuery({ queryKey: ['auth', 'me'], queryFn: () => apiFetch<AuthUser>('/auth/me'), retry: false })
  const [userOverride, setUserOverride] = useState<AuthUser | null>(null)
  const loginMutation = useMutation({ mutationFn: (input: { email: string; password: string }) => apiFetch<AuthUser>('/auth/login', { method: 'POST', body: JSON.stringify(input) }), onSuccess: (user) => { setUserOverride(null); queryClient.setQueryData(['auth', 'me'], user) } })
  const logoutMutation = useMutation({ mutationFn: () => apiFetch<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }), onSuccess: () => { setUserOverride(null); queryClient.setQueryData(['auth', 'me'], null) } })
  return <AuthContext.Provider value={{ user: userOverride ?? userQuery.data ?? null, isLoading: userQuery.isLoading, updateUser: (user) => { setUserOverride(user); queryClient.setQueryData(['auth', 'me'], user) }, login: (email, password) => loginMutation.mutateAsync({ email, password }).then(() => undefined), logout: () => logoutMutation.mutateAsync().then(() => undefined) }}>{children}</AuthContext.Provider>
}
