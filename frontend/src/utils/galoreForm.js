/* Galore form builder state helpers — shared by GaloreFormBuilder, the admin's
   create/edit flow and the overall Galore coordinator's form editor.
   People are assigned by name + email (each gets a Galore portal login):
     • each department's coordinator
     • each activity's coordinator, plus the club responsible for running it */

let keySeq = 0;
const nextKey = () => `k${Date.now().toString(36)}${keySeq++}`;
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());

export const blankActivity   = () => ({
  key: nextKey(), title: '', clubId: '', coordinatorName: '', coordinatorEmail: '',
  participationType: 'individual', minTeamSize: '', teamSize: '', genderSplit: false, registrationCount: 0,
  scheduleDate: '', time: '', venue: '', rulesUrl: '', rulesName: '',
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
        participationType: a.participationType === 'team' ? 'team' : 'individual',
        minTeamSize: a.minTeamSize || '', teamSize: a.teamSize || '',
        genderSplit: !!a.genderSplit, registrationCount: a.registrationCount || 0,
        scheduleDate: a.scheduleDate || '', time: a.time || '', venue: a.venue || '',
        rulesUrl: a.rulesUrl || '', rulesName: a.rulesName || '',
      })),
    })),
  };
}

/* Builder state → what POST /events/galore and PUT …/galore-form expect */
export function toPayload(b) {
  return {
    head: { name: (b.head?.name || '').trim(), email: (b.head?.email || '').trim().toLowerCase() },
    rulesUrl: b.rulesUrl || '', rulesName: b.rulesName || '',
    departments: b.departments.map(({ id, name, coordName, coordEmail }) => ({
      id, name: name.trim(), coordName: coordName.trim(), coordEmail: coordEmail.trim().toLowerCase(),
    })),
    categories: b.categories.map(c => ({
      id: c.id, name: c.name.trim(), maxPicks: Number(c.maxPicks) || 0,
      activities: c.activities.map(a => ({
        id: a.id, title: a.title.trim(), clubId: a.clubId,
        coordinatorName: a.coordinatorName.trim(), coordinatorEmail: a.coordinatorEmail.trim().toLowerCase(),
        participationType: a.participationType,
        minTeamSize: a.participationType === 'team' ? Number(a.minTeamSize) : 0,
        teamSize:    a.participationType === 'team' ? Number(a.teamSize)    : 0,
        genderSplit: a.genderSplit,
        scheduleDate: a.scheduleDate, time: a.time.trim(), venue: a.venue.trim(),
        rulesUrl: a.rulesUrl, rulesName: a.rulesName,
      })),
    })),
  };
}

/* Everything still missing, in the order the admin would fix it.
   requireHead: the admin must name the overall Galore coordinator (not asked
   when that coordinator is the one editing). */
export function builderProblems(b, { requireHead = true } = {}) {
  const out = [];
  if (requireHead) {
    if (!b.head?.name?.trim()) out.push("Add the overall Galore coordinator's name.");
    if (!b.head?.email?.trim()) out.push("Add the overall Galore coordinator's email.");
    else if (!isEmail(b.head.email)) out.push("The overall Galore coordinator's email isn't valid.");
  }
  if (!b.departments.length) out.push('Add at least one department.');
  const deptNames = new Set();
  b.departments.forEach((d, i) => {
    const n = d.name.trim();
    if (!n) out.push(`Department #${i + 1} needs a name.`);
    else if (deptNames.has(n.toLowerCase())) out.push(`Department "${n}" is listed twice.`);
    else deptNames.add(n.toLowerCase());
    if (n && (!d.coordName.trim() || !d.coordEmail.trim())) out.push(`${n} needs a department coordinator (name and email).`);
    else if (n && !isEmail(d.coordEmail)) out.push(`${n}: the department coordinator's email isn't valid.`);
  });
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
      if (t && !a.clubId) out.push(`${t}: pick the club responsible for it.`);
      if (t && (!a.coordinatorName.trim() || !a.coordinatorEmail.trim())) out.push(`${t} needs an activity coordinator (name and email).`);
      else if (t && !isEmail(a.coordinatorEmail)) out.push(`${t}: the activity coordinator's email isn't valid.`);
      if (t && a.participationType === 'team') {
        const min = Number(a.minTeamSize), max = Number(a.teamSize);
        if (!(min >= 1) || !(max >= min)) out.push(`${t}: set a team size (min ≥ 1, max ≥ min).`);
      }
    });
  });
  return out;
}
