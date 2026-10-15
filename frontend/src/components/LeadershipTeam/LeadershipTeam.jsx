import s from './LeadershipTeam.module.css';

const initials = (name = '') => name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';

/* A club's leadership team, read-only: its Faculty Advisor and Student
   Coordinators first, then every member role the Faculty Advisor assigned.
   Used on the student Leadership page and the admin's club Leadership panel.
     leadership  rows from GET /clubs/:id/leadership (.leadership)
     staff       [{ name, email, avatar, role }] (.staff)
     accent      club colour for the role badges */
export default function LeadershipTeam({ leadership = [], staff = [], accent = '#635bff', emptyText = 'No leadership roles assigned yet.' }) {
  if (!leadership.length && !staff.length) return <div className={s.empty}>{emptyText}</div>;
  return (
    <div className={s.grid}>
      {staff.map(p => (
        <div key={`staff-${p.id}`} className={s.card}>
          <div className={s.av}>{p.avatar ? <img src={p.avatar} alt="" /> : initials(p.name)}</div>
          <span className={s.role} style={{ background: `${accent}18`, color: accent }}>{p.role}</span>
          <div className={s.name}>{p.name}</div>
          {p.email && <div className={s.meta}>{p.email}</div>}
        </div>
      ))}
      {leadership.map(l => (
        <div key={l.id} className={s.card}>
          <div className={s.av}>{l.photo_url ? <img src={l.photo_url} alt="" /> : initials(l.holder_name || l.role_title)}</div>
          <span className={s.role} style={{ background: `${accent}18`, color: accent }}>{l.role_title}</span>
          <div className={s.name}>{l.holder_name || 'Vacant'}</div>
          {(l.dept || l.year) && <div className={s.meta}>{[l.dept, l.year].filter(Boolean).join(' · ')}</div>}
          {l.holder_email && <div className={s.meta}>{l.holder_email}</div>}
          {l.responsibilities && <div className={s.resp}>{l.responsibilities}</div>}
        </div>
      ))}
    </div>
  );
}
