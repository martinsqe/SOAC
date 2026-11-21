/* The "last date of registration" line under the Galore letterhead's strip —
   Galore's own, or Student of the Year's on that page. Stored as a date
   (YYYY-MM-DD) and always shown as one sentence:
     "Last date of registration is 17th January, 2027"
   Older values typed as free text are shown the same way. */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'}`;
};

export const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '').trim());

export function formatDeadlineDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d || m > 12) return iso;
  return `${ordinal(d)} ${MONTHS[m - 1]}, ${y}`;
}

export function deadlineSentence(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (isIsoDate(v)) return `Last date of registration is ${formatDeadlineDate(v)}`;
  const rest = v.replace(/^last\s+date\s+(of\s+)?registration\s*(is\b|:|-)?\s*/i, '');
  return `Last date of registration is ${rest || v}`;
}


/* Student of the Year — the one line shown under the strip (and on the student's
   page when there's no form):
     closed (last date passed, or Close pressed)  → "Registration closed"
     open with a last date                        → "Last date of registration is …"
     otherwise (no last date yet / not opened)     → "Registrations will be opened soon" */
export function sotyLine(c) {
  if (!c) return '';
  if (c.deadlinePassed || c.stopped) return 'Registration closed';
  if (c.opened && c.deadline) return deadlineSentence(c.deadline);
  return 'Registrations will be opened soon';
}
