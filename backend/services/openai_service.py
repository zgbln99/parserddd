"""
OpenAI integration — Stundenzettel OCR parsing via GPT-4o Vision.
"""

import json
import os

_STZ_PROMPT = '''You are an expert system for extracting structured data from handwritten German timesheets (DATEV format).

Your task is to read the provided image and extract work entries into structured JSON.

STRICT RULES:
* Do NOT guess missing or unclear values
* If a value is unreadable, return null
* Preserve original meaning, do not invent data
* Be precise: accuracy is more important than completeness
* Process the table row by row
* The day number is PRINTED in the leftmost column (Kalendertag 1-31). Read it directly.

NORMALIZATION RULES:
* "5 Uhr" -> "05:00", "19Uhr" -> "19:00", "5uhr" -> "05:00"
* "15.45" -> "15:45" (dot is time separator in German handwriting)
* "14.30" -> "14:30"
* If only hour is given, assume ":00"
* Breaks: "45 min" -> 45, "0,75" -> 45, "0,5" -> 30, "0.75" -> 45, "/" -> 0, "—" -> 0
* German codes: "F" = "Feiertag", "K" = "Krank", "U" = "Urlaub"
* Extract "Name des Mitarbeiters" from the header field at the top

OUTPUT FORMAT (JSON only, no explanation):
{"name":"...","days":[
{"day":1,"start_time":null,"end_time":null,"break_minutes":null,"notes":"","confidence":0.0},
{"day":2,"start_time":"05:00","end_time":"19:00","break_minutes":45,"notes":"Tour gefahren","confidence":1.0}
]}

CONFIDENCE per row:
* 1.0 = clearly readable
* 0.7 = minor uncertainty
* 0.4 = hard to read
* 0.0 = unreadable

IMPORTANT:
* Do not merge rows
* Do not skip rows - return ALL rows (28, 30, or 31 depending on month)
* If a row is empty or has only dashes, return it with null values
* Keep output strictly valid JSON
* "day" must match the PRINTED number in column 1'''


def _parse_stundenzettel_with_openai(image_data, media_type):
    """Send image to OpenAI GPT-4o Vision for OCR extraction."""
    import openai
    import base64

    api_key = os.environ.get('OPENAI_API_KEY', '')
    if not api_key:
        raise RuntimeError('OPENAI_API_KEY not configured. Set it in .env')

    client = openai.OpenAI(api_key=api_key)
    b64 = base64.b64encode(image_data).decode('utf-8')

    response = client.chat.completions.create(
        model='gpt-4o',
        max_tokens=4096,
        messages=[{
            'role': 'user',
            'content': [
                {
                    'type': 'image_url',
                    'image_url': {
                        'url': f'data:{media_type};base64,{b64}',
                        'detail': 'high',
                    },
                },
                {
                    'type': 'text',
                    'text': _STZ_PROMPT,
                },
            ],
        }],
    )
    raw_text = response.choices[0].message.content.strip()
    if raw_text.startswith('```'):
        raw_text = raw_text.split('\n', 1)[1] if '\n' in raw_text else raw_text[3:]
        if raw_text.endswith('```'):
            raw_text = raw_text[:-3].strip()
    return json.loads(raw_text)


def _calculate_stundenzettel(parsed):
    """Calculate work hours, night hours, diets from parsed Stundenzettel data."""
    days = parsed.get('days', [])
    results = []
    totals = {
        'work_minutes': 0,
        'night_25_minutes': 0,
        'night_40_minutes': 0,
        'diet_count': 0,
        'sick_days': 0,
        'vacation_days': 0,
        'holiday_days': 0,
        'work_days': 0,
    }

    month = parsed.get('month') or 1
    year = parsed.get('year') or 2026

    for entry in days:
        day_num = entry.get('day')
        start_str = entry.get('start_time') or entry.get('start')
        end_str = entry.get('end_time') or entry.get('end')
        pause = entry.get('break_minutes') or entry.get('pause_minutes') or 0
        if isinstance(pause, str):
            try:
                pause = int(float(pause))
            except (ValueError, TypeError):
                pause = 0
        notes = entry.get('notes') or entry.get('remarks') or ''
        code = entry.get('code') or ''
        if not code and notes:
            notes_upper = notes.strip().upper()
            if notes_upper in ('FEIERTAG', 'F'):
                code = 'F'
            elif notes_upper in ('KRANK', 'K'):
                code = 'K'
            elif notes_upper in ('URLAUB', 'U'):
                code = 'U'
        remarks = notes if code == '' else None

        day_result = {
            'day': day_num,
            'start': start_str,
            'end': end_str,
            'pause_minutes': pause,
            'code': code,
            'remarks': remarks,
            'work_minutes': 0,
            'night_25_minutes': 0,
            'night_40_minutes': 0,
            'has_diet': False,
        }

        if code == 'K':
            totals['sick_days'] += 1
            results.append(day_result)
            continue
        if code == 'U':
            totals['vacation_days'] += 1
            results.append(day_result)
            continue
        if code == 'F':
            totals['holiday_days'] += 1
            results.append(day_result)
            continue
        if code in ('UU', 'SA', 'SU'):
            results.append(day_result)
            continue

        if not start_str or not end_str:
            results.append(day_result)
            continue

        try:
            sh, sm = map(int, start_str.split(':'))
            eh, em = map(int, end_str.split(':'))
        except (ValueError, AttributeError):
            results.append(day_result)
            continue

        start_min = sh * 60 + sm
        end_min = eh * 60 + em
        if end_min <= start_min:
            end_min += 1440

        gross_minutes = end_min - start_min
        work_minutes = max(0, gross_minutes - pause)
        day_result['work_minutes'] = work_minutes
        totals['work_minutes'] += work_minutes
        totals['work_days'] += 1

        if gross_minutes >= 480:
            day_result['has_diet'] = True
            totals['diet_count'] += 1

        night_25 = 0
        night_40 = 0
        for m in range(start_min, min(start_min + gross_minutes - pause, end_min)):
            hour_of_day = (m % 1440) // 60
            if 22 <= hour_of_day <= 23:
                night_25 += 1
            elif 4 <= hour_of_day < 6:
                night_25 += 1
            elif 0 <= hour_of_day < 4:
                if start_min < 1440:
                    night_40 += 1
                else:
                    night_25 += 1

        day_result['night_25_minutes'] = night_25
        day_result['night_40_minutes'] = night_40
        totals['night_25_minutes'] += night_25
        totals['night_40_minutes'] += night_40

        results.append(day_result)

    def hm(m):
        return f"{m // 60}:{m % 60:02d}"

    totals['work_hm'] = hm(totals['work_minutes'])
    totals['work_decimal'] = round(totals['work_minutes'] / 60, 2)
    totals['night_25_hm'] = hm(totals['night_25_minutes'])
    totals['night_40_hm'] = hm(totals['night_40_minutes'])
    total_night = totals['night_25_minutes'] + totals['night_40_minutes']
    totals['total_night_minutes'] = total_night
    totals['total_night_hm'] = hm(total_night)

    return {
        'name': parsed.get('name', ''),
        'personal_nr': parsed.get('personal_nr', ''),
        'month': month,
        'year': year,
        'period': f"{year}-{int(month):02d}",
        'days': results,
        'totals': totals,
    }
