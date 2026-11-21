/* Helpers shared by every Galore dashboard (kept apart from the components in
   GaloreUI.jsx so fast refresh keeps working). */

/* Each role's pages — shown in the letterhead's grey nav strip (GalorePortal);
   the role's dashboard renders whichever page is picked there.
   soty = Student of the Year is published: the main coordinator sees its
   contestants, a student its entry form */
export const headPages = (soty = false) => [
  ['manage', 'Manage event'], ['schedule', 'Schedule'], ['departments', 'Departments'],
  ...(soty ? [['soty', 'Student of the Year']] : []),
];
export const staffPages = (list) => {
  const isAct = list.some(x => x.activities.length > 0);
  return [
    /* no Overview for either. Activity coordinator: Departments (each department's
       registrations + the teams the club formed, with Verify participant on it);
       department coordinator: their Registrations */
    isAct ? ['departments', 'Departments'] : ['registrations', 'Registrations'],
    ['schedule', 'Schedule'],
  ];
};
/* …and the pages every logged-in role has after its own */
export const commonPages = () => [['coordinators', 'Coordinators'], ['about', 'About Galore'], ['gallery', 'Gallery']];
/* the student's activities are named at the top of their Schedule page */
export const studentPages = (_list, soty = false) => [['schedule', 'Schedule'], ...(soty ? [['soty', 'Student of the Year']] : [])];


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

/* How an activity was defined on the Galore form — what its departments are
   represented by: 'team', 'duo' (exactly 2) or 'individual' */
export const unitOf = (a) => (a?.participationType !== 'team' ? 'individual'
  : Number(a.minTeamSize) === 2 && Number(a.teamSize) === 2 ? 'duo' : 'team');
/* "Selected teams" · "Selected duos" · "Selected individuals" */
export const selectedLabel = (unit) => `Selected ${unit === 'duo' ? 'duos' : unit === 'individual' ? 'individuals' : 'teams'}`;
