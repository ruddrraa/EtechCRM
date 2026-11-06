export const roleCopy = {
  SUPER_ADMIN: {
    eyebrow: 'System overview',
    description: 'A concise view of activity across Excel Technologies and Services.',
  },
  MARKETING_HEAD: {
    eyebrow: 'Marketing overview',
    description: 'Keep your team client activity and field assignments moving forward.',
  },
  MARKETING_EXECUTIVE: {
    eyebrow: 'Your workspace',
    description: 'Stay on top of today’s client conversations and follow-ups.',
  },
} as const

export const roleMetricLabels = {
  SUPER_ADMIN: ['Total clients', 'Active staff', 'Assigned visits', 'Completed visits'],
  MARKETING_HEAD: ['Total clients', 'Active staff', 'Assigned visits', 'Completed visits'],
  MARKETING_EXECUTIVE: ["Today's visits", 'Upcoming visits', 'In progress', 'Completed visits'],
} as const
