import React, { createContext, useContext } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../lib/api'

export interface OrganizationData {
  _id?: string
  name: string
  email?: string
  phone?: string
  address?: string
  expandedLogo?: string
  collapsedLogo?: string
}

interface OrganizationContextValue {
  organization: OrganizationData
  isLoading: boolean
  isError: boolean
  updateOrganization: (data: Partial<OrganizationData>) => Promise<OrganizationData>
  isUpdating: boolean
}

const defaultOrg: OrganizationData = {
  name: 'Excel Technologies and Services',
}

const OrganizationContext = createContext<OrganizationContextValue>({
  organization: defaultOrg,
  isLoading: false,
  isError: false,
  updateOrganization: async () => defaultOrg,
  isUpdating: false,
})

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()

  const { data, isLoading, isError } = useQuery<OrganizationData>({
    queryKey: ['organization'],
    queryFn: () => apiFetch<OrganizationData>('/organization'),
    staleTime: 60000,
  })

  const mutation = useMutation({
    mutationFn: (body: Partial<OrganizationData>) =>
      apiFetch<OrganizationData>('/organization', { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['organization'], updated)
      void queryClient.invalidateQueries({ queryKey: ['organization'] })
    },
  })

  const value: OrganizationContextValue = {
    organization: data ?? defaultOrg,
    isLoading,
    isError,
    updateOrganization: (payload) => mutation.mutateAsync(payload),
    isUpdating: mutation.isPending,
  }

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrganization() {
  return useContext(OrganizationContext)
}
