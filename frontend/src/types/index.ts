// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

export interface Driver {
  name: string;
  path: string;
  card_number: string;
  file_count: number;
  earliest_date: string;
  latest_date: string;
  latest_download: string;
  days_since: number | null;
  files: DriverFile[];
}

export interface DriverFile {
  name: string;
  path: string;
  size: number;
  modified: string;
  card_number: string;
  file_date: string;
}

export interface DriverInfo {
  card_number: string;
  card_issuing_authority: string;
  card_issue_date: string;
  card_expiry_date: string;
  driver_name: string;
  birth_date: string;
}

export interface TimeSegment {
  start: string;
  end: string;
  duration_minutes: number;
}

export interface ShiftDetail {
  shift_start: string;
  shift_end: string;
  shift_date: string;
  grid_date: string;
  weekday: string;
  duration_minutes: number;
  duration_hm: string;
  work_minutes: number;
  work_hm: string;
  work_decimal: number;
  driving_minutes: number;
  driving_hm: string;
  work_only_minutes: number;
  work_only_hm: string;
  avail_minutes: number;
  avail_hm: string;
  break_minutes: number;
  break_hm: string;
  night_25_minutes: number;
  night_25_hm: string;
  night_40_minutes: number;
  night_40_hm: string;
  has_diet: boolean;
  vehicles: string[];
  manual_minutes: number;
  manual_hm: string;
  driving_segments?: TimeSegment[];
  break_segments?: TimeSegment[];
}

export interface AnalysisSummary {
  total_work_hm: string;
  total_work_decimal: number;
  total_work_minutes: number;
  total_driving_hm: string;
  total_driving_minutes: number;
  total_break_hm: string;
  total_break_minutes: number;
  total_avail_hm: string;
  total_avail_minutes: number;
  night_25_hm: string;
  night_25_decimal: number;
  night_25_minutes: number;
  night_40_hm: string;
  night_40_decimal: number;
  night_40_minutes: number;
  total_night_hm: string;
  total_night_decimal: number;
  total_night_minutes: number;
  diet_count: number;
  total_shifts: number;
  total_manual_hm: string;
  total_manual_minutes: number;
}

export interface CardPlace {
  date: string;
  country: string;
  region: string;
  type: string;
}

export interface CardEvent {
  event_type?: string;
  begin_time?: string;
  end_time?: string;
  [key: string]: unknown;
}

export interface CalendarDayWork {
  date: string;
  weekday: string;
  shift_start: string;
  shift_end: string;
  duration_minutes: number;
  work_minutes: number;
  work_hm: string;
  driving_minutes: number;
  driving_hm: string;
  break_minutes: number;
  night_25_minutes: number;
  night_40_minutes: number;
  night_25_hm: string;
  night_40_hm: string;
  has_diet: boolean;
}

export interface ManualEntry {
  start: string;
  end: string;
  duration_minutes: number;
  declared_type: string;
}

export interface AnalysisResult {
  driver_info: DriverInfo;
  vehicles: { plate: string; first_use: string; last_use: string }[];
  summary: AnalysisSummary;
  shift_details: ShiftDetail[];
  calendar_days?: Record<string, CalendarDayWork>;
  manual_entries?: ManualEntry[];
  card_places?: CardPlace[];
  card_events?: CardEvent[];
  source_file?: string;
  error?: string;
  night_start_hour?: number;
}

export interface SyncHistoryEntry {
  timestamp: string;
  status: 'ok' | 'partial' | 'error';
  error?: string;
  found: number;
  uploaded: number;
  errors: number;
  files: SyncFileEntry[];
}

export interface SyncFileEntry {
  driver: string;
  file: string;
  path: string;
  size?: number;
  status: 'ok' | 'error';
  error?: string;
}

export interface DashboardData {
  driver_count: number;
  total_files: number;
  last_sync: string;
  synced_count: number;
  last_sync_status: string;
  last_sync_errors: number;
  last_sync_uploaded: number;
}

// DDD File Preview
export interface DddPreviewActivityRecord {
  date: string;
  total_activities: number;
  driving_minutes: number;
}

export interface DddPreviewVehicle {
  plate: string;
  first_use: string;
  last_use: string;
  odometer_begin_km: number;
  odometer_end_km: number;
}

export interface DddPreviewData {
  file_size: number;
  hex_dump: string;
  card_info: Record<string, string>;
  activity_records: DddPreviewActivityRecord[];
  vehicle_records: DddPreviewVehicle[];
  card_places: CardPlace[];
  card_events: CardEvent[];
}
