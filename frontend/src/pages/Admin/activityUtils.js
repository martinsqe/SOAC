import a from './AdminActivity.module.css';

export const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const cap = (t) => t ? t.charAt(0).toUpperCase() + t.slice(1) : '—';
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/* How recently something happened, as a label: within a month is active,
   within three months is quiet, anything older is inactive. */
const DAY = 86400000;
export function activityLevel(date) {
  if (!date) return { label: 'No activity', cls: a.lvlNone };
  const days = (Date.now() - new Date(date)) / DAY;
  if (days <= 30) return { label: 'Active', cls: a.lvlActive };
  if (days <= 90) return { label: 'Quiet', cls: a.lvlQuiet };
  return { label: 'Inactive', cls: a.lvlInactive };
}

export const ROLE_LABEL = { fa: 'Faculty advisor', sc: 'Student coordinator', member: 'Member' };

/* What a person has done for one club, as short [label, value] items. Staff are
   measured by what they ran; members by what they took part in. Zeros are left out. */
export function contributionItems(p) {
  const c = p.contribution || {};
  const items = [];
  const add = (label, value) => { if (value) items.push([label, value]); };
  if (p.kind !== 'member') {
    add('Events proposed', c.eventsProposed);
    add('Events approved', c.eventsApproved);
    add('Sessions held', c.sessionsHeld);
    add('Reports made', c.reportsMade);
    add('Reports submitted', c.reportsSubmitted);
    add('Announcements', c.announcements);
    add('Tasks assigned', c.tasksAssigned);
  }
  if (c.totalSessions && (p.kind === 'member' || c.sessionsAttended)) {
    items.push(['Sessions attended', `${c.sessionsAttended}/${c.totalSessions}`]);
  }
  add('Tasks done', c.tasksCompleted);
  add('Volunteered', c.volunteered);
  add('Club events', p.events?.inClub);
  add('Posts', c.posts);
  add('Messages', c.messages);
  return items;
}
