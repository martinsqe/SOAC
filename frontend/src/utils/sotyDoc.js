/* Student of the Year — the submitted file's data, built the same way for the
   student's review (from their form) and for a saved entry. */

/* "Name - Department - Sem IV": the file's name (name, department and semester only) */
export const docFileName = (d) => [d.name, d.department, semLabel(d.semester)].filter(Boolean).join(' - ');

/* 'IV' → 'Sem IV'; already 'Sem-VII/C' stays as it is */
export const semLabel = (v) => { const t = String(v || '').trim(); return !t ? '' : /^sem/i.test(t) ? t : `Sem ${t}`; };

/* a saved entry (+ the contest) → the document */
export const docFromEntry = (contest, e) => ({
  title: contest?.title || 'Student of the year',
  name: e.name, department: e.department || e.school || '', semester: e.semester,
  mobile: e.mobile, email: e.contactEmail,
  evenAttendance: e.evenAttendance, oddAttendance: e.oddAttendance, evenScore: e.evenScore, oddScore: e.oddScore,
  reason: e.reason,
  activities: (e.activities || []).map(a => ({ title: a.title, description: a.description, file: a.file })),
});
