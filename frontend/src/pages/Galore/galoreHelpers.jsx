import { useState } from 'react';
import { TBA } from './GaloreUI';
import s from './Galore.module.css';

/* Helpers shared by every Galore dashboard (kept apart from the components in
   GaloreUI.jsx so fast refresh keeps working). */

export const whenOf = (a) => ([a.dateLabel, a.time].filter(Boolean).join(', ') || <TBA />);
export const typeLabel = (a) =>
  (a.participationType === 'team' ? `Team (${a.minTeamSize}–${a.teamSize})` : 'Individual') + (a.genderSplit ? ' · Boys/Girls' : '');


/* Section tabs — the same row under every event header */
export function useSections(items) {
  const [value, setValue] = useState(items[0]?.[0]);
  const current = items.some(([k]) => k === value) ? value : items[0]?.[0];
  const bar = (
    <div className={s.sections} role="tablist">
      {items.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={current === k}
          className={`${s.sectionTab} ${current === k ? s.sectionTabOn : ''}`} onClick={() => setValue(k)}>
          {label}
        </button>
      ))}
    </div>
  );
  return [current, bar];
}


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

