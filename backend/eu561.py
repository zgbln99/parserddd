"""
EU 561/2006 Compliance Engine.

Calculates driving time limits, rest periods, break rules, weekly rest
compensation, and detects infringements based on tachograph activity data.

Rules implemented:
  - Daily driving: max 9h (extendable to 10h max 2x/week)
  - Weekly driving: max 56h
  - Fortnightly (bi-weekly) driving: max 90h
  - Break after 4.5h continuous driving: min 45min (splittable 15+30)
  - Daily rest: min 11h (reducible to 9h, max 3x between weekly rests)
  - Weekly rest: min 45h (reducible to 24h every other week)
  - Compensation for reduced weekly rest before end of 3rd following week
  - 6x24h rule: weekly rest must start within 6×24h of previous weekly rest
"""

from datetime import datetime, timedelta
from typing import Optional


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DAILY_DRIVE_LIMIT = 9 * 60          # 540 min
DAILY_DRIVE_EXTENDED = 10 * 60      # 600 min
MAX_EXTENDED_PER_WEEK = 2

WEEKLY_DRIVE_LIMIT = 56 * 60        # 3360 min
FORTNIGHTLY_DRIVE_LIMIT = 90 * 60   # 5400 min

CONTINUOUS_DRIVE_LIMIT = 270        # 4.5h = 270 min
BREAK_REQUIRED = 45                 # 45 min
BREAK_SPLIT_FIRST = 15              # first part of split break
BREAK_SPLIT_SECOND = 30             # second part of split break

DAILY_REST_NORMAL = 11 * 60         # 660 min
DAILY_REST_REDUCED = 9 * 60         # 540 min
MAX_REDUCED_DAILY_REST = 3          # max 3 reduced daily rests between weekly rests

WEEKLY_REST_NORMAL = 45 * 60        # 2700 min
WEEKLY_REST_REDUCED = 24 * 60       # 1440 min

SIX_DAYS_HOURS = 6 * 24 * 60       # 8640 min = 144h

COMPENSATION_DEADLINE_WEEKS = 3     # must compensate by end of 3rd following week


def minutes_to_hm(minutes: int) -> str:
    h = minutes // 60
    m = minutes % 60
    return f"{h}:{m:02d}"


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

class DrivingPeriod:
    """A continuous period of driving (between breaks)."""
    __slots__ = ('start', 'end', 'minutes')

    def __init__(self, start: datetime, end: datetime):
        self.start = start
        self.end = end
        self.minutes = int((end - start).total_seconds() / 60)


class RestPeriod:
    """A continuous rest/break period."""
    __slots__ = ('start', 'end', 'minutes')

    def __init__(self, start: datetime, end: datetime):
        self.start = start
        self.end = end
        self.minutes = int((end - start).total_seconds() / 60)


class DayAnalysis:
    """Analysis for a single 24h period (from end of last daily rest)."""

    def __init__(self, date: str, driving_minutes: int, work_minutes: int,
                 rest_minutes: int, is_extended: bool, daily_rest_minutes: int,
                 infringements: list):
        self.date = date
        self.driving_minutes = driving_minutes
        self.work_minutes = work_minutes
        self.rest_minutes = rest_minutes
        self.is_extended = is_extended
        self.daily_rest_minutes = daily_rest_minutes
        self.infringements = infringements

    def to_dict(self) -> dict:
        return {
            'date': self.date,
            'driving_minutes': self.driving_minutes,
            'driving_hm': minutes_to_hm(self.driving_minutes),
            'work_minutes': self.work_minutes,
            'work_hm': minutes_to_hm(self.work_minutes),
            'rest_minutes': self.rest_minutes,
            'rest_hm': minutes_to_hm(self.rest_minutes),
            'is_extended': self.is_extended,
            'daily_rest_minutes': self.daily_rest_minutes,
            'daily_rest_hm': minutes_to_hm(self.daily_rest_minutes),
            'infringements': self.infringements,
        }


# ---------------------------------------------------------------------------
# Helpers: parse activity timeline
# ---------------------------------------------------------------------------

# Activity states from Samsara / tachograph
STATE_REST = 0       # BREAK/REST
STATE_AVAIL = 1      # AVAILABILITY
STATE_WORK = 2       # WORK (other work)
STATE_DRIVING = 3    # DRIVING

SAMSARA_STATE_MAP = {
    'BREAK/REST': STATE_REST,
    'WORK': STATE_WORK,
    'DRIVING': STATE_DRIVING,
    'AVAILABILITY': STATE_AVAIL,
}


def parse_samsara_activity(samsara_data: list) -> list:
    """Convert Samsara tachograph-activity response to internal timeline format.

    Input: list of {startTime, endTime, state, isManualEntry}
    Output: list of (start_dt, end_dt, state_int)
    """
    timeline = []
    for entry in samsara_data:
        start_str = entry.get('startTime', '')
        end_str = entry.get('endTime', '')
        state_str = entry.get('state', '')
        if not start_str or not end_str:
            continue
        try:
            start = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
            end = datetime.fromisoformat(end_str.replace('Z', '+00:00'))
        except (ValueError, TypeError):
            continue
        state = SAMSARA_STATE_MAP.get(state_str, STATE_REST)
        timeline.append((start, end, state))

    timeline.sort(key=lambda x: x[0])
    return timeline


def parse_ddd_timeline(records: list) -> list:
    """Convert parsed .ddd activity records to internal timeline format.

    Uses the same format as app.py build_timeline but without CET conversion
    (we keep UTC for EU 561 calculations).
    """
    from zoneinfo import ZoneInfo
    UTC = ZoneInfo('UTC')
    timeline = []
    sorted_records = sorted(records, key=lambda r: r.get('activity_record_date', ''))
    for record in sorted_records:
        date_str = record.get('activity_record_date')
        if not date_str:
            continue
        base_date = datetime.strptime(date_str[:10], '%Y-%m-%d').replace(tzinfo=UTC)
        changes = record.get('activity_change_info') or []
        for i, change in enumerate(changes):
            start_min = change['minutes']
            work_type = change['work_type']
            end_min = changes[i + 1]['minutes'] if i + 1 < len(changes) else 1440
            if end_min > start_min:
                start_dt = base_date + timedelta(minutes=start_min)
                end_dt = base_date + timedelta(minutes=end_min)
                timeline.append((start_dt, end_dt, work_type))

    timeline.sort(key=lambda x: x[0])
    return timeline


# ---------------------------------------------------------------------------
# Core: detect rest periods and driving blocks
# ---------------------------------------------------------------------------

def find_rest_periods(timeline: list, min_rest_minutes: int = 0) -> list:
    """Find all rest/break periods from timeline."""
    rests = []
    for start, end, state in timeline:
        if state == STATE_REST:
            duration = int((end - start).total_seconds() / 60)
            if duration >= min_rest_minutes:
                rests.append(RestPeriod(start, end))
    return rests


def find_daily_rests(timeline: list) -> list:
    """Find daily rest periods (>= 9h continuous rest)."""
    return find_rest_periods(timeline, DAILY_REST_REDUCED)


def find_weekly_rests(timeline: list) -> list:
    """Find weekly rest periods (>= 24h continuous rest)."""
    return find_rest_periods(timeline, WEEKLY_REST_REDUCED)


def get_driving_minutes_in_range(timeline: list, start: datetime, end: datetime) -> int:
    """Sum driving minutes within a time range."""
    total = 0
    for t_start, t_end, state in timeline:
        if state != STATE_DRIVING:
            continue
        # Overlap
        o_start = max(t_start, start)
        o_end = min(t_end, end)
        if o_end > o_start:
            total += int((o_end - o_start).total_seconds() / 60)
    return total


def get_work_minutes_in_range(timeline: list, start: datetime, end: datetime) -> int:
    """Sum work+driving+availability minutes within a time range."""
    total = 0
    for t_start, t_end, state in timeline:
        if state == STATE_REST:
            continue
        o_start = max(t_start, start)
        o_end = min(t_end, end)
        if o_end > o_start:
            total += int((o_end - o_start).total_seconds() / 60)
    return total


# ---------------------------------------------------------------------------
# Break rule analysis (4.5h driving / 45min break)
# ---------------------------------------------------------------------------

def analyze_breaks(timeline: list) -> list:
    """Check break rules: max 4.5h continuous driving before 45min break.

    Returns list of infringements.
    """
    infringements = []
    accumulated_driving = 0
    accumulated_break = 0
    first_break_taken = False  # for split break (15+30)
    last_driving_end = None

    for start, end, state in timeline:
        duration = int((end - start).total_seconds() / 60)

        if state == STATE_DRIVING:
            accumulated_driving += duration
            last_driving_end = end

            if accumulated_driving > CONTINUOUS_DRIVE_LIMIT:
                infringements.append({
                    'type': 'break_violation',
                    'severity': 'serious' if accumulated_driving > CONTINUOUS_DRIVE_LIMIT + 30 else 'minor',
                    'date': start.strftime('%Y-%m-%d'),
                    'time': start.strftime('%H:%M'),
                    'detail': f'Jazda ciągła {minutes_to_hm(accumulated_driving)} bez wymaganej przerwy 45min',
                    'detail_de': f'Durchgehende Lenkzeit {minutes_to_hm(accumulated_driving)} ohne erforderliche 45min Pause',
                    'driving_minutes': accumulated_driving,
                    'limit_minutes': CONTINUOUS_DRIVE_LIMIT,
                })

        elif state == STATE_REST:
            accumulated_break += duration

            # Check if break is sufficient
            if not first_break_taken and accumulated_break >= BREAK_SPLIT_FIRST:
                first_break_taken = True

            if accumulated_break >= BREAK_REQUIRED:
                # Full break taken - reset
                accumulated_driving = 0
                accumulated_break = 0
                first_break_taken = False
            elif first_break_taken and accumulated_break >= BREAK_SPLIT_FIRST + BREAK_SPLIT_SECOND:
                # Split break completed (15 + 30)
                accumulated_driving = 0
                accumulated_break = 0
                first_break_taken = False

        else:
            # Work or availability - resets break accumulation but not driving
            if accumulated_break < BREAK_REQUIRED:
                accumulated_break = 0
                first_break_taken = False

    return infringements


# ---------------------------------------------------------------------------
# Daily driving analysis
# ---------------------------------------------------------------------------

def analyze_daily_driving(timeline: list) -> list:
    """Analyze daily driving limits.

    A 'day' in EU 561 is the period between daily rests.
    Returns list of day analyses.
    """
    if not timeline:
        return []

    daily_rests = find_daily_rests(timeline)
    days = []

    # Build day boundaries from daily rests
    boundaries = []
    period_start = timeline[0][0]

    for rest in daily_rests:
        boundaries.append((period_start, rest.start))
        period_start = rest.end

    # Add the final period after last rest
    if timeline:
        boundaries.append((period_start, timeline[-1][1]))

    extended_count_this_week = 0
    current_week_start = None

    for day_start, day_end in boundaries:
        date_str = day_start.strftime('%Y-%m-%d')
        driving = get_driving_minutes_in_range(timeline, day_start, day_end)
        work = get_work_minutes_in_range(timeline, day_start, day_end)

        # Find the daily rest that follows this period
        daily_rest_min = 0
        for rest in daily_rests:
            if abs((rest.start - day_end).total_seconds()) < 120:
                daily_rest_min = rest.minutes
                break

        # Track week for extended driving count
        iso_week = day_start.isocalendar()
        week_key = (iso_week[0], iso_week[1])
        if current_week_start != week_key:
            current_week_start = week_key
            extended_count_this_week = 0

        is_extended = driving > DAILY_DRIVE_LIMIT
        infringements = []

        if is_extended:
            extended_count_this_week += 1

        if driving > DAILY_DRIVE_EXTENDED:
            infringements.append({
                'type': 'daily_driving_exceeded',
                'severity': 'very_serious' if driving > DAILY_DRIVE_EXTENDED + 60 else 'serious',
                'date': date_str,
                'detail': f'Dzienny czas jazdy {minutes_to_hm(driving)} przekracza maks. 10h',
                'detail_de': f'Tägliche Lenkzeit {minutes_to_hm(driving)} übersteigt max. 10h',
                'driving_minutes': driving,
                'limit_minutes': DAILY_DRIVE_EXTENDED,
            })
        elif is_extended and extended_count_this_week > MAX_EXTENDED_PER_WEEK:
            infringements.append({
                'type': 'too_many_extended_days',
                'severity': 'serious',
                'date': date_str,
                'detail': f'Więcej niż 2 dni z przedłużonym czasem jazdy (10h) w tygodniu',
                'detail_de': f'Mehr als 2 Tage mit verlängerter Lenkzeit (10h) in der Woche',
                'driving_minutes': driving,
                'limit_minutes': DAILY_DRIVE_LIMIT,
            })

        # Daily rest check
        if daily_rest_min > 0 and daily_rest_min < DAILY_REST_REDUCED:
            infringements.append({
                'type': 'daily_rest_insufficient',
                'severity': 'serious',
                'date': date_str,
                'detail': f'Dzienny odpoczynek {minutes_to_hm(daily_rest_min)} poniżej min. 9h',
                'detail_de': f'Tägliche Ruhezeit {minutes_to_hm(daily_rest_min)} unter min. 9h',
                'rest_minutes': daily_rest_min,
                'limit_minutes': DAILY_REST_REDUCED,
            })

        rest_in_period = 0
        for s, e, st in timeline:
            if st == STATE_REST and s >= day_start and e <= day_end:
                rest_in_period += int((e - s).total_seconds() / 60)

        days.append(DayAnalysis(
            date=date_str,
            driving_minutes=driving,
            work_minutes=work,
            rest_minutes=rest_in_period,
            is_extended=is_extended,
            daily_rest_minutes=daily_rest_min,
            infringements=infringements,
        ))

    return days


# ---------------------------------------------------------------------------
# Weekly analysis
# ---------------------------------------------------------------------------

def analyze_weekly(timeline: list, days: list) -> list:
    """Analyze weekly driving limits and weekly rest periods.

    Returns list of week summaries with infringements.
    """
    if not days:
        return []

    # Group days by ISO week
    weeks = {}
    for day in days:
        try:
            dt = datetime.strptime(day.date, '%Y-%m-%d')
        except ValueError:
            continue
        iso = dt.isocalendar()
        week_key = f"{iso[0]}-W{iso[1]:02d}"
        if week_key not in weeks:
            weeks[week_key] = {
                'week': week_key,
                'year': iso[0],
                'week_nr': iso[1],
                'days': [],
                'driving_minutes': 0,
                'work_minutes': 0,
                'infringements': [],
            }
        weeks[week_key]['days'].append(day)
        weeks[week_key]['driving_minutes'] += day.driving_minutes
        weeks[week_key]['work_minutes'] += day.work_minutes

    week_list = sorted(weeks.values(), key=lambda w: (w['year'], w['week_nr']))

    # Check weekly driving limits
    for week in week_list:
        if week['driving_minutes'] > WEEKLY_DRIVE_LIMIT:
            week['infringements'].append({
                'type': 'weekly_driving_exceeded',
                'severity': 'very_serious',
                'week': week['week'],
                'detail': f'Tygodniowy czas jazdy {minutes_to_hm(week["driving_minutes"])} przekracza 56h',
                'detail_de': f'Wöchentliche Lenkzeit {minutes_to_hm(week["driving_minutes"])} übersteigt 56h',
                'driving_minutes': week['driving_minutes'],
                'limit_minutes': WEEKLY_DRIVE_LIMIT,
            })

    # Check fortnightly (bi-weekly) driving limits
    for i in range(len(week_list) - 1):
        two_week_driving = week_list[i]['driving_minutes'] + week_list[i + 1]['driving_minutes']
        if two_week_driving > FORTNIGHTLY_DRIVE_LIMIT:
            inf = {
                'type': 'fortnightly_driving_exceeded',
                'severity': 'very_serious',
                'week': f"{week_list[i]['week']} + {week_list[i + 1]['week']}",
                'detail': f'Dwutygodniowy czas jazdy {minutes_to_hm(two_week_driving)} przekracza 90h',
                'detail_de': f'Zwei-Wochen-Lenkzeit {minutes_to_hm(two_week_driving)} übersteigt 90h',
                'driving_minutes': two_week_driving,
                'limit_minutes': FORTNIGHTLY_DRIVE_LIMIT,
            }
            week_list[i + 1]['infringements'].append(inf)

    # Detect weekly rest periods
    weekly_rests = find_weekly_rests(timeline)
    for week in week_list:
        week_start_str = week['days'][0].date if week['days'] else ''
        if week_start_str:
            ws = datetime.strptime(week_start_str, '%Y-%m-%d')
            we = ws + timedelta(days=7)
            week_rests_in_period = [
                r for r in weekly_rests
                if r.start >= ws and r.start < we
            ]
            if week_rests_in_period:
                longest = max(week_rests_in_period, key=lambda r: r.minutes)
                week['weekly_rest_minutes'] = longest.minutes
                week['weekly_rest_start'] = longest.start.strftime('%Y-%m-%d %H:%M')
                week['weekly_rest_end'] = longest.end.strftime('%Y-%m-%d %H:%M')
                week['weekly_rest_reduced'] = longest.minutes < WEEKLY_REST_NORMAL
                if week['weekly_rest_reduced']:
                    week['compensation_minutes'] = WEEKLY_REST_NORMAL - longest.minutes
                    week['compensation_hm'] = minutes_to_hm(WEEKLY_REST_NORMAL - longest.minutes)
            else:
                week['weekly_rest_minutes'] = 0
                week['weekly_rest_reduced'] = False

    return week_list


# ---------------------------------------------------------------------------
# Weekly rest compensation tracking
# ---------------------------------------------------------------------------

def analyze_compensation(weeks: list) -> list:
    """Track weekly rest compensation obligations.

    When a reduced weekly rest is taken, the difference (45h - actual)
    must be compensated en bloc before end of 3rd following week,
    attached to a rest of at least 9h.

    Returns list of compensation entries.
    """
    compensations = []

    for i, week in enumerate(weeks):
        if not week.get('weekly_rest_reduced'):
            continue

        compensation_min = week.get('compensation_minutes', 0)
        if compensation_min <= 0:
            continue

        deadline_week_idx = i + COMPENSATION_DEADLINE_WEEKS
        deadline_week = weeks[deadline_week_idx]['week'] if deadline_week_idx < len(weeks) else '?'

        compensations.append({
            'week': week['week'],
            'reduced_rest_minutes': week.get('weekly_rest_minutes', 0),
            'reduced_rest_hm': minutes_to_hm(week.get('weekly_rest_minutes', 0)),
            'compensation_minutes': compensation_min,
            'compensation_hm': minutes_to_hm(compensation_min),
            'deadline_week': deadline_week,
            'status': 'pending',
        })

    # Check if compensations were fulfilled
    for comp in compensations:
        # Look for a rest period >= 45h in weeks up to deadline
        # (this is a simplified check - full check would need rest period analysis)
        comp_week_idx = None
        for i, w in enumerate(weeks):
            if w['week'] == comp['week']:
                comp_week_idx = i
                break

        if comp_week_idx is not None:
            deadline_idx = comp_week_idx + COMPENSATION_DEADLINE_WEEKS
            for j in range(comp_week_idx + 1, min(deadline_idx + 1, len(weeks))):
                rest = weeks[j].get('weekly_rest_minutes', 0)
                if rest >= WEEKLY_REST_NORMAL:
                    comp['status'] = 'fulfilled'
                    comp['fulfilled_week'] = weeks[j]['week']
                    break

            if comp['status'] == 'pending':
                if deadline_idx < len(weeks):
                    comp['status'] = 'overdue'

    return compensations


# ---------------------------------------------------------------------------
# Reduced daily rest tracking
# ---------------------------------------------------------------------------

def analyze_reduced_daily_rests(timeline: list, weeks: list) -> list:
    """Track reduced daily rests (max 3 between weekly rests).

    Returns list of infringements if exceeded.
    """
    daily_rests = find_daily_rests(timeline)
    weekly_rests = find_weekly_rests(timeline)
    infringements = []

    # Build intervals between weekly rests
    boundaries = []
    start = timeline[0][0] if timeline else None
    for wr in weekly_rests:
        if start:
            boundaries.append((start, wr.start))
        start = wr.end
    if start and timeline:
        boundaries.append((start, timeline[-1][1]))

    for b_start, b_end in boundaries:
        reduced_count = 0
        for dr in daily_rests:
            if dr.start >= b_start and dr.end <= b_end:
                if dr.minutes < DAILY_REST_NORMAL:
                    reduced_count += 1

        if reduced_count > MAX_REDUCED_DAILY_REST:
            infringements.append({
                'type': 'too_many_reduced_daily_rests',
                'severity': 'serious',
                'date': b_start.strftime('%Y-%m-%d'),
                'detail': f'{reduced_count} skróconych odpoczynków dziennych (max 3) między odpoczynkami tygodniowymi',
                'detail_de': f'{reduced_count} verkürzte Tagesruhezeiten (max 3) zwischen Wochenruhezeiten',
                'count': reduced_count,
                'limit': MAX_REDUCED_DAILY_REST,
            })

    return infringements


# ---------------------------------------------------------------------------
# 6×24h rule
# ---------------------------------------------------------------------------

def analyze_six_day_rule(timeline: list) -> list:
    """Check that weekly rest starts within 6×24h of previous weekly rest.

    Returns list of infringements.
    """
    weekly_rests = find_weekly_rests(timeline)
    infringements = []

    for i in range(1, len(weekly_rests)):
        prev_end = weekly_rests[i - 1].end
        curr_start = weekly_rests[i].start
        gap_minutes = int((curr_start - prev_end).total_seconds() / 60)

        if gap_minutes > SIX_DAYS_HOURS:
            infringements.append({
                'type': 'six_day_rule_exceeded',
                'severity': 'very_serious',
                'date': curr_start.strftime('%Y-%m-%d'),
                'detail': f'Odstęp między odpoczynkami tygodniowymi {minutes_to_hm(gap_minutes)} przekracza 6×24h (144h)',
                'detail_de': f'Abstand zwischen Wochenruhezeiten {minutes_to_hm(gap_minutes)} übersteigt 6×24h (144h)',
                'gap_minutes': gap_minutes,
                'limit_minutes': SIX_DAYS_HOURS,
            })

    return infringements


# ---------------------------------------------------------------------------
# Remaining driving time calculator
# ---------------------------------------------------------------------------

def calculate_remaining_time(timeline: list) -> dict:
    """Calculate remaining driving time for current day/week.

    Returns a summary of what the driver can still do today.
    """
    if not timeline:
        return {
            'daily_remaining_minutes': DAILY_DRIVE_LIMIT,
            'daily_remaining_hm': minutes_to_hm(DAILY_DRIVE_LIMIT),
            'weekly_remaining_minutes': WEEKLY_DRIVE_LIMIT,
            'weekly_remaining_hm': minutes_to_hm(WEEKLY_DRIVE_LIMIT),
            'continuous_remaining_minutes': CONTINUOUS_DRIVE_LIMIT,
            'continuous_remaining_hm': minutes_to_hm(CONTINUOUS_DRIVE_LIMIT),
            'break_needed': False,
            'daily_rest_needed_by': None,
        }

    now = timeline[-1][1]  # Use end of last activity as "now"

    # Find last daily rest to determine current day start
    daily_rests = find_daily_rests(timeline)
    if daily_rests:
        last_daily_rest = daily_rests[-1]
        day_start = last_daily_rest.end
    else:
        day_start = timeline[0][0]

    # Daily driving so far
    daily_driving = get_driving_minutes_in_range(timeline, day_start, now)
    daily_remaining = max(0, DAILY_DRIVE_LIMIT - daily_driving)

    # Can the driver extend to 10h today?
    iso_week = day_start.isocalendar()
    week_start = day_start - timedelta(days=day_start.weekday())
    week_end = week_start + timedelta(days=7)

    # Count extended days this week
    days = analyze_daily_driving(timeline)
    extended_this_week = sum(
        1 for d in days
        if d.is_extended and d.date >= week_start.strftime('%Y-%m-%d')
        and d.date < week_end.strftime('%Y-%m-%d')
    )

    can_extend = extended_this_week < MAX_EXTENDED_PER_WEEK
    if can_extend:
        daily_remaining_extended = max(0, DAILY_DRIVE_EXTENDED - daily_driving)
    else:
        daily_remaining_extended = daily_remaining

    # Weekly driving
    week_driving = get_driving_minutes_in_range(
        timeline,
        week_start.replace(tzinfo=day_start.tzinfo) if day_start.tzinfo else week_start,
        now
    )
    weekly_remaining = max(0, WEEKLY_DRIVE_LIMIT - week_driving)

    # Continuous driving (since last break >= 45min)
    continuous_driving = 0
    for start, end, state in reversed(timeline):
        if state == STATE_DRIVING:
            continuous_driving += int((end - start).total_seconds() / 60)
        elif state == STATE_REST:
            rest_dur = int((end - start).total_seconds() / 60)
            if rest_dur >= BREAK_REQUIRED:
                break
            # Smaller breaks don't reset
        else:
            # Work/availability don't reset break counter
            pass

    continuous_remaining = max(0, CONTINUOUS_DRIVE_LIMIT - continuous_driving)
    break_needed = continuous_remaining == 0

    # When does daily rest need to start? (24h after day start)
    daily_rest_deadline = day_start + timedelta(hours=24) - timedelta(hours=11)

    return {
        'daily_driving_minutes': daily_driving,
        'daily_driving_hm': minutes_to_hm(daily_driving),
        'daily_remaining_minutes': daily_remaining,
        'daily_remaining_hm': minutes_to_hm(daily_remaining),
        'daily_remaining_extended_minutes': daily_remaining_extended,
        'daily_remaining_extended_hm': minutes_to_hm(daily_remaining_extended),
        'can_extend_today': can_extend,
        'weekly_driving_minutes': week_driving,
        'weekly_driving_hm': minutes_to_hm(week_driving),
        'weekly_remaining_minutes': weekly_remaining,
        'weekly_remaining_hm': minutes_to_hm(weekly_remaining),
        'continuous_driving_minutes': continuous_driving,
        'continuous_driving_hm': minutes_to_hm(continuous_driving),
        'continuous_remaining_minutes': continuous_remaining,
        'continuous_remaining_hm': minutes_to_hm(continuous_remaining),
        'break_needed': break_needed,
        'daily_rest_needed_by': daily_rest_deadline.strftime('%Y-%m-%d %H:%M') if daily_rest_deadline else None,
    }


# ---------------------------------------------------------------------------
# Full EU 561 analysis
# ---------------------------------------------------------------------------

def analyze_eu561(timeline: list, driver_name: str = '', card_number: str = '') -> dict:
    """Run full EU 561 compliance analysis on a timeline.

    Args:
        timeline: list of (start_dt, end_dt, state_int) tuples
        driver_name: optional driver name
        card_number: optional card number

    Returns:
        Complete analysis result dict.
    """
    if not timeline:
        return {
            'driver_name': driver_name,
            'card_number': card_number,
            'period_start': '',
            'period_end': '',
            'days': [],
            'weeks': [],
            'compensations': [],
            'remaining': {},
            'all_infringements': [],
            'summary': {
                'total_infringements': 0,
                'minor': 0,
                'serious': 0,
                'very_serious': 0,
                'total_driving_minutes': 0,
                'total_driving_hm': '0:00',
                'total_work_minutes': 0,
                'total_work_hm': '0:00',
                'days_analyzed': 0,
                'weeks_analyzed': 0,
            },
        }

    period_start = timeline[0][0].strftime('%Y-%m-%d')
    period_end = timeline[-1][1].strftime('%Y-%m-%d')

    # Run all analyses
    days = analyze_daily_driving(timeline)
    weeks = analyze_weekly(timeline, days)
    compensations = analyze_compensation(weeks)
    break_infringements = analyze_breaks(timeline)
    reduced_rest_infringements = analyze_reduced_daily_rests(timeline, weeks)
    six_day_infringements = analyze_six_day_rule(timeline)
    remaining = calculate_remaining_time(timeline)

    # Collect all infringements
    all_infringements = []
    for day in days:
        all_infringements.extend(day.infringements)
    for week in weeks:
        all_infringements.extend(week.get('infringements', []))
    all_infringements.extend(break_infringements)
    all_infringements.extend(reduced_rest_infringements)
    all_infringements.extend(six_day_infringements)

    # Add overdue compensations as infringements
    for comp in compensations:
        if comp['status'] == 'overdue':
            all_infringements.append({
                'type': 'compensation_overdue',
                'severity': 'very_serious',
                'week': comp['week'],
                'detail': f'Kompensacja {comp["compensation_hm"]} za skrócony weekend nie odebrana do {comp["deadline_week"]}',
                'detail_de': f'Kompensation {comp["compensation_hm"]} für verkürzte Wochenruhe nicht bis {comp["deadline_week"]} genommen',
                'compensation_minutes': comp['compensation_minutes'],
            })

    # Summary
    minor = sum(1 for i in all_infringements if i.get('severity') == 'minor')
    serious = sum(1 for i in all_infringements if i.get('severity') == 'serious')
    very_serious = sum(1 for i in all_infringements if i.get('severity') == 'very_serious')

    total_driving = sum(d.driving_minutes for d in days)
    total_work = sum(d.work_minutes for d in days)

    # Serialize weeks (remove DayAnalysis objects)
    weeks_serialized = []
    for week in weeks:
        w = {k: v for k, v in week.items() if k != 'days'}
        w['driving_hm'] = minutes_to_hm(week['driving_minutes'])
        w['work_hm'] = minutes_to_hm(week['work_minutes'])
        w['weekly_rest_hm'] = minutes_to_hm(week.get('weekly_rest_minutes', 0))
        w['days_count'] = len(week.get('days', []))
        w['day_dates'] = [d.date for d in week.get('days', [])]
        weeks_serialized.append(w)

    return {
        'driver_name': driver_name,
        'card_number': card_number,
        'period_start': period_start,
        'period_end': period_end,
        'days': [d.to_dict() for d in days],
        'weeks': weeks_serialized,
        'compensations': compensations,
        'remaining': remaining,
        'all_infringements': all_infringements,
        'summary': {
            'total_infringements': len(all_infringements),
            'minor': minor,
            'serious': serious,
            'very_serious': very_serious,
            'total_driving_minutes': total_driving,
            'total_driving_hm': minutes_to_hm(total_driving),
            'total_work_minutes': total_work,
            'total_work_hm': minutes_to_hm(total_work),
            'days_analyzed': len(days),
            'weeks_analyzed': len(weeks),
        },
    }
