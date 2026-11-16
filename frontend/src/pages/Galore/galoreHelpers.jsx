import { TBA } from './GaloreUI';

/* Helpers shared by every Galore dashboard (kept apart from the components in
   GaloreUI.jsx so fast refresh keeps working). */

export const whenOf = (a) => ([a.dateLabel, a.time].filter(Boolean).join(', ') || <TBA />);
export const typeLabel = (a) =>
  (a.participationType !== 'team' ? 'Individual'
    : Number(a.minTeamSize) === 2 && Number(a.teamSize) === 2 ? 'Duo'
    : `Team (${a.minTeamSize}–${a.teamSize} players)`) + (a.genderSplit ? ' · Boys/Girls' : '');


/* Each role's pages — shown in the letterhead's grey nav strip (GalorePortal);
   the role's dashboard renders whichever page is picked there. */
/* The main coordinator's Overview, Registrations, People, Galore form and
   Event details live together under "Manage event" (cards that open each one).
   soty = Student of the Year is published: the main coordinator sees its
   contestants, a student its entry form */
export const headPages = (soty = false) => [
  ['manage', 'Manage event'], ['schedule', 'Schedule'], ['departments', 'Departments'],
  ...(soty ? [['soty', 'Student of the Year']] : []),
];
export const staffPages = (list) => {
  const isAct = list.some(x => x.activities.length > 0);
  return [
    ['overview', 'Overview'],
    ['registrations', 'Registrations'],
    ...(isAct ? [['teams', 'Teams & fixtures'], ['verify', 'Verify participant']] : []),
  ];
};
/* …and the pages every logged-in role has after its own */
export const commonPages = () => [['coordinators', 'Coordinators'], ['about', 'About Galore'], ['gallery', 'Gallery']];
export const studentPages = (list, soty = false) => {
  const n = list.reduce((sum, x) => sum + x.activities.length, 0);
  return [['timetable', 'Timetable'], ['activities', `My activities (${n})`], ...(soty ? [['soty', 'Student of the Year']] : [])];
};


/* ── Scheduling conflicts: two activities on the same date at the same time.
   With registrations, counts the students registered for both — the clash
   that actually matters. ── */
const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const dayOf = (a) => a.scheduleDate || a.date || ''; // form activities / portal activities
export function findClashes(activities, registrations = null) {
  const timed = activities.filter(a => dayOf(a) && norm(a.time));
  const emailsOf = new Map();
  for (const r of registrations || []) {
    if (!emailsOf.has(r.eventId)) emailsOf.set(r.eventId, new Set());
    emailsOf.get(r.eventId).add(String(r.email).toLowerCase());
  }
  const out = [];
  for (let i = 0; i < timed.length; i++) for (let j = i + 1; j < timed.length; j++) {
    const a = timed[i], b = timed[j];
    if (dayOf(a) !== dayOf(b) || norm(a.time) !== norm(b.time)) continue;
    const ea = emailsOf.get(a.id), eb = emailsOf.get(b.id);
    const shared = ea && eb ? [...ea].filter(e => eb.has(e)).length : null;
    const sameVenue = norm(a.venue) && norm(a.venue) === norm(b.venue);
    out.push({ a, b, when: `${a.dateLabel || dayOf(a)}, ${a.time}`, shared, sameVenue });
  }
  return out;
}

