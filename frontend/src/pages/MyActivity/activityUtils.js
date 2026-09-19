export const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/* Mirrors event_certificates_issued.category (see certificates.controller.js) —
   'winner' | 'runner_up' | 'participation'. A registrant only ever has one of these
   per event (the result they actually got), but sort by rank anyway in case more
   than one certificate row exists. An event with none of them is simply "Registered". */
const STATUS_LABEL = { winner: 'Winner', runner_up: 'Runner-up', participation: 'Participation' };
const STATUS_RANK  = { winner: 0, runner_up: 1, participation: 2 };

export const eventStatus = (achievements) => {
  if (!achievements?.length) return 'Registered';
  const best = [...achievements].sort((a, b) => (STATUS_RANK[a.category] ?? 9) - (STATUS_RANK[b.category] ?? 9))[0];
  return STATUS_LABEL[best.category] || 'Registered';
};
