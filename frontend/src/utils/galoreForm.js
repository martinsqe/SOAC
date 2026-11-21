/* Galore form state helpers — shared by the Galore form editor (categories,
   activities, clubs, players, guidelines) and the main coordinator's
   Coordinators page (departments + their coordinators, activity coordinators).
   Both edit the one saved form: each saves its own part on top of the latest
   saved copy of the other (mergeForSave), so neither undoes the other.
   Coordinators are optional until assigned — each gets a Galore portal login. */

let keySeq = 0;
const nextKey = () => `k${Date.now().toString(36)}${keySeq++}`;
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

export const blankActivity   = () => ({
  key: nextKey(), title: '', clubId: '', coordinatorName: '', coordinatorEmail: '',
  participationType: 'individual', minTeamSize: '', teamSize: '', genderSplit: false, registrationCount: 0,
  scheduleDate: '', time: '', reportingTime: '', venue: '', duration: '', rulesUrl: '', rulesName: '',
});
export const blankCategory   = () => ({ key: nextKey(), name: '', maxPicks: 2, activities: [blankActivity()] });
export const blankDepartment = () => ({ key: nextKey(), name: '', coordName: '', coordEmail: '' });

/* Server form (template or /galore-setup) → builder state with stable React keys */
export function toBuilder(form) {
  return {
    head: { name: form?.head?.name || '', email: form?.head?.email || '' },
    rulesUrl: form?.rulesUrl || '', rulesName: form?.rulesName || '',
    departments: (form?.departments || []).map(d => ({
      key: nextKey(), id: d.id, name: d.name || '', coordName: d.coordName || '', coordEmail: d.coordEmail || '',
    })),
    categories: (form?.categories || []).map(c => ({
      key: nextKey(), id: c.id, name: c.name || '', maxPicks: c.maxPicks ?? 2,
      activities: (c.activities || []).map(a => ({
        key: nextKey(), id: a.id, title: a.title || '',
        clubId: a.clubId || '', coordinatorName: a.coordinatorName || '', coordinatorEmail: a.coordinatorEmail || '',
        /* a team of exactly two is a duo */
        participationType: a.participationType !== 'team' ? 'individual'
          : Number(a.minTeamSize) === 2 && Number(a.teamSize) === 2 ? 'duo' : 'team',
        minTeamSize: a.minTeamSize || '', teamSize: a.teamSize || '',
        genderSplit: !!a.genderSplit, registrationCount: a.registrationCount || 0,
        scheduleDate: a.scheduleDate || '', time: a.time || '', reportingTime: a.reportingTime || '', venue: a.venue || '', duration: a.duration || '',
        rulesUrl: a.rulesUrl || '', rulesName: a.rulesName || '',
      })),
    })),
  };
}

/* Builder state → what PUT …/form expects */
export function toPayload(b) {
  return {
    head: { name: (b.head?.name || '').trim(), email: (b.head?.email || '').trim().toLowerCase() },
    rulesUrl: b.rulesUrl || '', rulesName: b.rulesName || '',
    departments: b.departments.map(({ id, name, coordName, coordEmail }) => ({
      id, name: name.trim(), coordName: (coordName || '').trim(), coordEmail: (coordEmail || '').trim().toLowerCase(),
    })),
    categories: b.categories.map(c => ({
      id: c.id, name: c.name.trim(), maxPicks: Number(c.maxPicks) || 0,
      activities: c.activities.map(a => ({
        id: a.id, title: a.title.trim(), clubId: a.clubId,
        coordinatorName: (a.coordinatorName || '').trim(), coordinatorEmail: (a.coordinatorEmail || '').trim().toLowerCase(),
        participationType: a.participationType === 'duo' ? 'team' : a.participationType,
        minTeamSize: a.participationType === 'duo' ? 2 : a.participationType === 'team' ? Number(a.minTeamSize) : 0,
        teamSize:    a.participationType === 'duo' ? 2 : a.participationType === 'team' ? Number(a.teamSize)    : 0,
        genderSplit: a.genderSplit,
        scheduleDate: a.scheduleDate, time: a.time.trim(), reportingTime: (a.reportingTime || '').trim(), venue: a.venue.trim(), duration: (a.duration || '').trim(),
        rulesUrl: a.rulesUrl, rulesName: a.rulesName,
      })),
    })),
  };
}

/* One part saved on top of the latest saved form (fresh = the server form):
     'form'   categories / activities / clubs / players / guidelines from b;
              departments and every coordinator from fresh (a brand-new form
              keeps b's departments — the usual list — to assign afterwards)
     'coords' departments and activity coordinators from b; the rest from fresh */
export function mergeForSave(fresh, b, part) {
  const f = toBuilder(fresh);
  const coordOf = (cats) => new Map(cats.flatMap(c => c.activities).filter(a => a.id != null).map(a => [String(a.id), a]));
  const withCoords = (cats, from) => cats.map(c => ({
    ...c,
    activities: c.activities.map(a => {
      const o = a.id != null && from.get(String(a.id));
      return o ? { ...a, coordinatorName: o.coordinatorName, coordinatorEmail: o.coordinatorEmail } : a;
    }),
  }));
  if (part === 'form') {
    const saved = f.departments.length > 0 || f.categories.length > 0;
    return { ...b, head: f.head, departments: saved ? f.departments : b.departments, categories: withCoords(b.categories, coordOf(f.categories)) };
  }
  return { ...f, departments: b.departments, categories: withCoords(f.categories, coordOf(b.categories)) };
}

/* The Galore form: categories and activities (players required for teams) */
export function formProblems(b) {
  const out = [];
  if (!b.categories.length) out.push('Add at least one category.');
  const catNames = new Set(), actNames = new Set();
  b.categories.forEach((c, i) => {
    const n = c.name.trim();
    if (!n) out.push(`Category #${i + 1} needs a name.`);
    else if (catNames.has(n.toLowerCase())) out.push(`Category "${n}" is listed twice.`);
    else catNames.add(n.toLowerCase());
    if (!c.activities.length) out.push(`Add at least one activity to ${n || `category #${i + 1}`}.`);
    c.activities.forEach((a, j) => {
      const t = a.title.trim();
      if (!t) out.push(`Activity #${j + 1} in ${n || `category #${i + 1}`} needs a name.`);
      else if (actNames.has(t.toLowerCase())) out.push(`Activity "${t}" is listed twice.`);
      else actNames.add(t.toLowerCase());
      if (t && a.participationType === 'team') {
        const min = Number(a.minTeamSize), max = Number(a.teamSize);
        if (!(min >= 1) || !(max >= min)) out.push(`${t}: set the minimum and maximum players (min at least 1, max at least min).`);
      }
    });
  });
  return out;
}

/* The Coordinators page: departments, and any coordinator typed in must be whole */
export function coordProblems(b) {
  const out = [];
  if (!b.departments.length) out.push('Add at least one department.');
  const deptNames = new Set();
  b.departments.forEach((d, i) => {
    const n = d.name.trim();
    if (!n) out.push(`Department #${i + 1} needs a name.`);
    else if (deptNames.has(n.toLowerCase())) out.push(`Department "${n}" is listed twice.`);
    else deptNames.add(n.toLowerCase());
    const name = (d.coordName || '').trim(), email = (d.coordEmail || '').trim();
    if (n && !name !== !email) out.push(`${n}: add both the department coordinator's name and email.`);
    else if (n && email && !isEmail(email)) out.push(`${n}: the department coordinator's email isn't valid.`);
  });
  b.categories.forEach(c => c.activities.forEach(a => {
    const name = (a.coordinatorName || '').trim(), email = (a.coordinatorEmail || '').trim();
    if (!name !== !email) out.push(`${a.title}: add both the activity coordinator's name and email.`);
    else if (email && !isEmail(email)) out.push(`${a.title}: the activity coordinator's email isn't valid.`);
  }));
  return out;
}
