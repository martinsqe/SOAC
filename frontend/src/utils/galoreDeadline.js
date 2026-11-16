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

/* Student of the Year — where registration stands, in one line */
export function sotyStatus(c) {
  if (!c) return '';
  const fmt = (d) => formatDeadlineDate(d);
  const pub = c.published === false ? 'Draft — not in the Galore portal yet. ' : '';
  if (!c.opensOn) return `${pub}Set the day registration opens — until then students see “Registration will open soon, check back later”.`;
  if (!c.opened) return `${pub}Registration opens on ${fmt(c.opensOn)}${c.deadline ? ` and closes after ${fmt(c.deadline)}` : ''}. Until then students see “Registration will open soon”.`;
  if (c.deadlinePassed) return `${pub}Registration closed — the last date was ${fmt(c.deadline)}.`;
  return `${pub}Registration is open${c.deadline ? ` until ${fmt(c.deadline)}` : ' — no last date set yet'}.`;
}
