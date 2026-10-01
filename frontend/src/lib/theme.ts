// Centralized color tokens for the application.
// FleetView palette (see styles/globals.css) + Samsara activity-timeline colors.

export const COLORS = {
  primary: '#1d5fd1',
  primaryBg: '#eef4fd',
  dark: '#0f172a',
  dark2: '#182338',
  dark3: '#243149',
  dark4: '#334155',
  dark5: '#64748b',
  dark6: '#8b97ad',
  gray1: '#f6f8fb',
  gray2: '#eef1f5',
  stroke: '#dde3ea',
  strokeDark: '#243149',
  cardDark: '#121b2d',
  pageDark: '#0b1220',
  green: '#1a7f4b',
  red: '#b91c1c',
  blue: '#1d5fd1',
  yellow: '#b45309',
  // Status badge colors
  statusGreen: '#1a7f4b',
  statusRed: '#b91c1c',
  statusOrange: '#b45309',
} as const;

export const ACTIVITY_COLORS = {
  DRIVING: '#4ade80',
  WORK: '#f59e0b',
  REST: '#3b82f6',
  AVAILABILITY: '#9ca3af',
  UNKNOWN: '#e5e7eb',
} as const;
