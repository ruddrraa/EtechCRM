export const activityData = [
  { day: 'Mon', visits: 18, completed: 13 },
  { day: 'Tue', visits: 24, completed: 19 },
  { day: 'Wed', visits: 21, completed: 16 },
  { day: 'Thu', visits: 30, completed: 25 },
  { day: 'Fri', visits: 27, completed: 22 },
  { day: 'Sat', visits: 14, completed: 11 },
  { day: 'Sun', visits: 9, completed: 8 },
]

export const upcomingVisits = [
  { client: 'AMRI Hospital', owner: 'Aarav Mehta', date: 'Today, 11:30 AM', status: 'Assigned' },
  { client: 'Mediview Diagnostics', owner: 'Isha Kapoor', date: 'Tomorrow, 09:00 AM', status: 'Planned' },
  { client: 'CityCare Clinic', owner: 'Rohan Das', date: 'Thu, 02:15 PM', status: 'Planned' },
]

export const roleCopy = {
  SUPER_ADMIN: {
    eyebrow: 'System overview',
    name: 'Ranjit Singh',
    initials: 'RS',
    title: 'Good morning, Ranjit Singh',
    description: 'A concise view of activity across Excel Technologies and Services.',
    metrics: [
      ['Total clients', '248', '+12.4%'],
      ['Active staff', '36', '+4.2%'],
      ['Assigned visits', '124', '+8.1%'],
      ['Completed visits', '89', '+16.8%'],
    ],
  },
  ADMIN: {
    eyebrow: 'Operations overview',
    name: 'Priya Shah',
    initials: 'PS',
    title: 'Good morning, Priya Shah',
    description: 'Keep client activity and field assignments moving forward.',
    metrics: [
      ['Total clients', '184', '+9.4%'],
      ['Active staff', '24', '+2.2%'],
      ['Assigned visits', '86', '+6.1%'],
      ['Completed visits', '64', '+11.8%'],
    ],
  },
  USER: {
    eyebrow: 'Your workspace',
    name: 'Aarav Mehta',
    initials: 'AM',
    title: 'Good morning, Aarav Mehta',
    description: 'Stay on top of today’s client conversations and follow-ups.',
    metrics: [
      ["Today's visits", '4', '+2 this week'],
      ['Upcoming visits', '8', 'Next 14 days'],
      ['In progress', '1', 'Checked in'],
      ['Completed visits', '27', '+5 this month'],
    ],
  },
} as const
