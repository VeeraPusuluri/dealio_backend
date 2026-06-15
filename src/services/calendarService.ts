// Generates RFC 5545 iCalendar (.ics) content for a meeting invite

function parseToUtc(dateStr: string, timeStr: string): { start: string; end: string } {
  // dateStr: YYYY-MM-DD   timeStr: "10:30 AM" | "14:30" | "10:30"
  const parts = dateStr.split('-').map(Number);
  const year  = parts[0] ?? 2000;
  const month = parts[1] ?? 1;
  const day   = parts[2] ?? 1;

  let hours = 0;
  let minutes = 0;

  const ampm = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (ampm) {
    hours   = parseInt(ampm[1] ?? '0');
    minutes = parseInt(ampm[2] ?? '0');
    const meridiem = (ampm[3] ?? '').toUpperCase();
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
  } else {
    const timeParts = timeStr.split(':');
    hours   = parseInt(timeParts[0] ?? '0');
    minutes = parseInt(timeParts[1] ?? '0');
  }

  const fmt = (n: number) => String(n).padStart(2, '0');
  const base = `${year}${fmt(month)}${fmt(day)}T${fmt(hours)}${fmt(minutes)}00`;

  // End = start + 1 hour
  const endHour = (hours + 1) % 24;
  const end = `${year}${fmt(month)}${fmt(day)}T${fmt(endHour)}${fmt(minutes)}00`;

  return { start: base, end };
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export interface CalendarAttendee {
  email: string;
  name: string;
  role?: 'CHAIR' | 'REQ-PARTICIPANT';
}

export interface CalendarInviteParams {
  uid: string;
  summary: string;
  description: string;
  location: string;
  dateStr: string;   // YYYY-MM-DD
  timeStr: string;   // h:mm AM/PM or HH:MM
  organizer: CalendarAttendee;
  attendees: CalendarAttendee[];
}

export function generateICS(params: CalendarInviteParams): string {
  const { start, end } = parseToUtc(params.dateStr, params.timeStr);
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const attendeeLines = params.attendees
    .map(a => {
      const role = a.role ?? 'REQ-PARTICIPANT';
      return `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=${role};PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=${icsEscape(a.name)}:mailto:${a.email}`;
    })
    .join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dealio//Dealio Platform//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${params.uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(params.summary)}`,
    `DESCRIPTION:${icsEscape(params.description)}`,
    `LOCATION:${icsEscape(params.location)}`,
    `ORGANIZER;CN=${icsEscape(params.organizer.name)}:mailto:${params.organizer.email}`,
    attendeeLines,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder: site visit in 1 hour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
