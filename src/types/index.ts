export type Role = 'SUPER_ADMIN' | 'MARKETING_HEAD' | 'MARKETING_EXECUTIVE'
export type AuthUser = { _id: string; name: string; email: string; role: Role; phone?: string; avatar?: string }

export type NavItem = {
  label: string
  path: string
  icon: string
}
