// Centralized color tokens for the application.
// NextAdmin design-system palette + Samsara activity-timeline colors.

export const COLORS = {
  primary: '#5750f1',
  primaryBg: 'rgba(87,80,241,0.07)',
  dark: '#111928',
  dark2: '#1f2a37',
  dark3: '#374151',
  dark4: '#4b5563',
  dark5: '#6b7280',
  dark6: '#9ca3af',
  gray1: '#f9fafb',
  gray2: '#f3f4f6',
  stroke: '#e6ebf1',
  strokeDark: '#27303e',
  cardDark: '#122031',
  pageDark: '#020d1a',
  green: '#22ad5c',
  red: '#f23030',
  blue: '#3c50e0',
  yellow: '#f59e0b',
  // Status badge colors (from NextAdmin)
  statusGreen: '#219653',
  statusRed: '#D34053',
  statusOrange: '#FFA70B',
} as const;

export const ACTIVITY_COLORS = {
  DRIVING: '#4ade80',
  WORK: '#f59e0b',
  REST: '#3b82f6',
  AVAILABILITY: '#9ca3af',
  UNKNOWN: '#e5e7eb',
} as const;
