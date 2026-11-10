export type Role = 'SUPER_ADMIN' | 'MARKETING_HEAD' | 'MARKETING_EXECUTIVE'

export type NotificationPreferences = {
  dailyProductivity?: boolean
  newEventCreated?: boolean
  mobilePush?: boolean
  desktopAlerts?: boolean
  emailSummary?: boolean
}

export type AuthUser = {
  _id: string
  name: string
  email: string
  role: Role
  phone?: string
  avatar?: string
  avatarAsset?: string
  notificationPreferences?: NotificationPreferences
}

export type NotificationItem = {
  _id: string
  recipient: string
  title: string
  message: string
  type: 'VISIT_ASSIGNED' | 'VISIT_CANCELLED' | 'VISIT_UPDATED' | 'TEST'
  entityType?: 'Visit' | 'Client'
  entityId?: string
  readAt?: string
  createdAt: string
}

export type NavItem = {
  label: string
  path: string
  icon: string
}
