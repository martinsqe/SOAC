import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import s from './AdminMembers.module.css';

/* ── constants ── */
const ROLE_COLOR = { admin: '#635bff', student: '#00c896', coordinator: '#ff9500' };
const ROLE_BG    = { admin: '#635bff18', student: '#00c89618', coordinator: '#ff950018' };
const GRADS = [
  'linear-gradient(135deg,#3DDC84,#635BFF)', 'linear-gradient(135deg,#FF6B35,#FFD166)',
  'linear-gradient(135deg,#A259FF,#3DDC84)', 'linear-gradient(135deg,#06D6A0,#00E5FF)',
  'linear-gradient(135deg,#FF6B9D,#FF9500)', 'linear-gradient(135deg,#635BFF,#A259FF)',
];

/* ── helpers ── */
function Avatar({ name, size = 34 }) {
  const initials = (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const hue = name ? name.charCodeAt(0) * 5 % 360 : 200;
  return (
    <div className={s.avatar} style={{ width: size, height: size, background: `hsl(${hue},55%,55%)` }}>
      {initials}
    </div>
  );
}

const initials = (name = '') =>
  (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function useDebounce(val, delay = 350) {
  const [d, setD] = useState(val);
  useEffect(() => {
    const t = setTimeout(() => setD(val), delay);
    return () => clearTimeout(t);
  }, [val, delay]);
  return d;
}

const PAGE_SIZE = 25;

/* ═══════════════════════════════════════════════════════════════════════════
   TAB 1 — Users (admin / coordinator / student account management)
═══════════════════════════════════════════════════════════════════════════ */
function UsersTab({ clubs }) {
  const navigate = useNavigate();
  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [roleF,      setRoleF]      = useState('all');
  const [error,      setError]      = useState('');
  const [assignUser, setAssignUser] = useState(null);
  const [assignClub, setAssignClub] = useState('');
  const [assigning,  setAssigning]  = useState(false);
  const [toast,      setToast]      = useState('');

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const loadUsers = useCallback(() => {
    setLoading(true);
    api.get('/users')
      .then(d => setUsers(d.users || []))
      .catch(() => setError('Failed to load users.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleAssign = async () => {
    if (!assignUser) return;
    setAssigning(true);
    try {
      await api.put(`/users/${assignUser.id}/assign-club`, { clubId: assignClub || null });
      showToast(`Club assigned to ${assignUser.name}`);
      setAssignUser(null);
      loadUsers();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setAssigning(false);
    }
  };

  const roles = ['all', ...Array.from(new Set(users.map(u => u.role)))];
  const filtered = users.filter(u => {
    const mr = roleF === 'all' || u.role === roleF;
    const mq = !search
      || u.name?.toLowerCase().includes(search.toLowerCase())
      || u.email?.toLowerCase().includes(search.toLowerCase());
    return mr && mq;
  });

  const active       = users.filter(u => u.is_active).length;
  const admins       = users.filter(u => u.role === 'admin').length;
  const coordinators = users.filter(u => u.role === 'coordinator');
  const students     = users.filter(u => u.role === 'student').length;

  return (
    <>
      {toast && (
        <div style={{ position:'fixed', bottom:24, right:24, zIndex:9999, background:'#1a1040', color:'#fff', padding:'11px 20px', borderRadius:4, fontSize:13, fontWeight:500, boxShadow:'0 6px 24px rgba(0,0,0,.22)' }}>
          {toast}
        </div>
      )}

      {assignUser && (
        <div style={{ position:'fixed', inset:0, zIndex:10000, background:'rgba(15,10,46,.55)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:18, padding:28, maxWidth:420, width:'100%', boxShadow:'0 24px 64px rgba(0,0,0,.22)' }}>
            <div style={{ fontWeight:800, fontSize:16, color:'#0f0a2e', marginBottom:6 }}>Assign Club to Coordinator</div>
            <div style={{ fontSize:13, color:'#6b7280', marginBottom:20 }}>Coordinator: <strong>{assignUser.name}</strong></div>
            <div style={{ marginBottom:18 }}>
              <label style={{ fontSize:11, fontWeight:700, color:'#374151', display:'block', marginBottom:6 }}>Select Club</label>
              <select value={assignClub} onChange={e => setAssignClub(e.target.value)}
                style={{ width:'100%', padding:'10px 12px', borderRadius:9, border:'1.5px solid #e5e7eb', fontSize:13, outline:'none' }}>
                <option value="">— Unassign / No club —</option>
                {clubs.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
              </select>
            </div>
            {assignClub && (
              <div style={{ background:'#f0fff8', border:'1px solid #86efac', borderRadius:9, padding:'9px 13px', marginBottom:16, fontSize:12, color:'#15803d' }}>
                ✓ {clubs.find(c => c._id === assignClub)?.name} will be assigned to {assignUser.name}
              </div>
            )}
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setAssignUser(null)} style={{ flex:1, padding:10, borderRadius:4, border:'1.5px solid #e5e7eb', background:'transparent', fontSize:13, fontWeight:700, color:'#6b7280', cursor:'pointer' }}>Cancel</button>
              <button onClick={handleAssign} disabled={assigning} style={{ flex:2, padding:10, borderRadius:4, border:'none', background:'#635BFF', color:'#fff', fontSize:13, fontWeight:800, cursor:'pointer', opacity:assigning?.6:1 }}>
                {assigning ? 'Saving…' : 'Confirm Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      {!loading && (
        <div className={s.statsStrip}>
          {[
            { n: users.length, l: 'Total', c: '#0f0a2e' },
            { n: active,       l: 'Active',      c: '#00c896' },
            { n: admins,       l: 'Admins',      c: '#635bff' },
            { n: coordinators.length, l: 'Coordinators', c: '#ff9500' },
            { n: students,     l: 'Students',    c: '#06b6d4' },
            { n: users.length - active, l: 'Inactive', c: '#ef4444' },
          ].map(({ n, l, c }) => (
            <div key={l} className={s.statBox}>
              <div className={s.statNum} style={{ color: c }}>{n}</div>
              <div className={s.statLabel}>{l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Coordinator overview */}
      {!loading && coordinators.length > 0 && (
        <div style={{ background:'#fff', border:'1.5px solid #ede9fe', borderRadius:12, marginBottom:24, overflow:'hidden' }}>
          <div style={{ padding:'16px 20px', background:'linear-gradient(135deg,#f5f3ff,#ede9fe)', borderBottom:'1px solid #ddd6fe', display:'flex', alignItems:'center', justifyContent:'space-between', gap:16 }}>
            <div>
              <div style={{ fontSize:13, fontWeight:800, color:'#4c1d95' }}>Club Coordinators</div>
              <div style={{ fontSize:11, color:'#7c3aed', marginTop:2 }}>{coordinators.length} coordinator{coordinators.length !== 1 ? 's' : ''} across clubs</div>
            </div>
            <button
              onClick={() => navigate('/admin/clubs')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 700, color: '#fff',
                padding: '9px 18px',
                border: 'none',
                borderRadius: 8,
                background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                boxShadow: '0 4px 14px rgba(109,40,217,.35)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'opacity .18s, transform .18s',
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '.88'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1';   e.currentTarget.style.transform = 'translateY(0)'; }}
            >
              Assign via All Clubs
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
              </svg>
            </button>
          </div>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#faf8ff' }}>
                  {['Coordinator', 'Email', 'Assigned Club', 'Status'].map(h => (
                    <th key={h} style={{ padding:'9px 16px', textAlign:'left', fontWeight:700, color:'#6b7280', fontSize:11, textTransform:'uppercase', letterSpacing:.7, borderBottom:'1px solid #f0eeff' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {coordinators.map((c, i) => {
                  const assignedClub = clubs.find(cl => String(cl._id) === String(c.managed_club_id));
                  return (
                    <tr key={c.id} style={{ borderBottom: i < coordinators.length - 1 ? '1px solid #f5f3ff' : 'none' }}>
                      <td style={{ padding:'10px 16px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                          <div style={{ width:30, height:30, borderRadius:'50%', background:`hsl(${(c.name?.charCodeAt(0)||70)*5%360},55%,55%)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:'#fff', flexShrink:0 }}>
                            {c.name?.charAt(0)?.toUpperCase() || 'C'}
                          </div>
                          <span style={{ fontWeight:600, color:'#111827' }}>{c.name}</span>
                        </div>
                      </td>
                      <td style={{ padding:'10px 16px', color:'#6b7280', fontSize:12 }}>{c.email}</td>
                      <td style={{ padding:'10px 16px' }}>
                        {assignedClub
                          ? <span style={{ background:'#f0fdf4', color:'#15803d', padding:'3px 10px', borderRadius:6, fontSize:12, fontWeight:600 }}>{assignedClub.name}</span>
                          : <span style={{ color:'#9ca3af', fontSize:12, fontStyle:'italic' }}>Not assigned</span>}
                      </td>
                      <td style={{ padding:'10px 16px' }}>
                        <span style={{ fontSize:11, fontWeight:600, color: c.is_active ? '#007a5e' : '#9ca3af' }}>
                          {c.is_active ? '● Active' : '○ Inactive'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className={s.filters}>
        <div className={s.searchWrap}>
          <svg className={s.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input className={s.searchInput} placeholder="Search by name or email…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className={s.roleTabs}>
          {roles.map(r => (
            <button key={r}
              className={`${s.roleTab} ${roleF === r ? s.roleTabOn : ''}`}
              style={roleF === r && r !== 'all' ? { borderBottomColor: ROLE_COLOR[r] || '#636363', color: ROLE_COLOR[r] || '#555' } : {}}
              onClick={() => setRoleF(r)}
            >
              {r === 'all' ? 'All' : r.charAt(0).toUpperCase() + r.slice(1)}
              {r !== 'all' && ` (${users.filter(u => u.role === r).length})`}
            </button>
          ))}
        </div>
      </div>

      {error && <div className={s.errorBar}>{error}</div>}

      {loading ? (
        <div className={s.tableCard}>{Array.from({length:5}).map((_,i) => <div key={i} className={s.skeletonRow}/>)}</div>
      ) : filtered.length === 0 ? (
        <div className={s.empty}><p>No members found</p><span>Try a different filter</span></div>
      ) : (
        <div className={s.tableCard}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Member</th><th>Email</th><th>Role</th><th>Assigned Club</th><th>Status</th><th>Last Login</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id}>
                  <td data-label=""><div className={s.memberCell}><Avatar name={u.name}/><span className={s.memberName}>{u.name}</span></div></td>
                  <td data-label="Email" className={s.emailCell}>{u.email}</td>
                  <td data-label="Role">
                    <span className={s.roleBadge} style={{ borderBottomColor: ROLE_COLOR[u.role] || '#f4f4f8', color: ROLE_COLOR[u.role] || '#555' }}>{u.role}</span>
                  </td>
                  <td data-label="Club">
                    {u.role === 'coordinator' ? (
                      <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap', justifyContent:'flex-end' }}>
                        <span style={{ fontSize:11, fontWeight:600, color: u.managed_club_id ? '#007a5e' : '#9ca3af' }}>
                          {u.managed_club_id ? (clubs.find(c => String(c._id) === String(u.managed_club_id))?.name || 'Assigned') : 'Not assigned'}
                        </span>
                        <button onClick={() => { setAssignUser(u); setAssignClub(u.managed_club_id || ''); }}
                          style={{ fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:6, border:'1.5px solid #635BFF', background:'transparent', color:'#635BFF', cursor:'pointer' }}>
                          {u.managed_club_id ? 'Change' : 'Assign'}
                        </button>
                      </div>
                    ) : <span className={s.muted}>—</span>}
                  </td>
                  <td data-label="Status"><span className={s.statusDot} style={{ color: u.is_active ? '#007a5e' : '#9ca3af' }}>{u.is_active ? '● Active' : '○ Inactive'}</span></td>
                  <td data-label="Login" className={s.muted}>{timeAgo(u.last_login)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   TAB 2 — Club Members (all student memberships with full join-request info)
═══════════════════════════════════════════════════════════════════════════ */
function ClubMembersTab({ clubs }) {
  const [members,    setMembers]    = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');

  const [search,  setSearch]  = useState('');
  const [clubId,  setClubId]  = useState('');
  const [dept,    setDept]    = useState('');
  const [year,    setYear]    = useState('');
  const [page,    setPage]    = useState(1);
  const [detail,  setDetail]  = useState(null);

  /* option lists built from first load */
  const [deptOpts, setDeptOpts] = useState([]);
  const [yearOpts, setYearOpts] = useState([]);

  const debouncedSearch = useDebounce(search);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page, limit: PAGE_SIZE });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (clubId)          params.set('clubId', clubId);
    if (dept)            params.set('dept',   dept);
    if (year)            params.set('year',   year);

    api.get(`/clubs/members?${params}`)
      .then(({ members: list, pagination: pg }) => {
        setMembers(list || []);
        setPagination(pg || { page:1, total:0, pages:1 });
        if (!debouncedSearch && !clubId && !dept && !year && page === 1) {
          setDeptOpts([...new Set(list.map(m => m.dept).filter(Boolean))].sort());
          setYearOpts([...new Set(list.map(m => m.year).filter(Boolean))].sort());
        }
      })
      .catch(err => setError(err.message || 'Failed to load members'))
      .finally(() => setLoading(false));
  }, [debouncedSearch, clubId, dept, year, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedSearch, clubId, dept, year]);

  const hasFilters = search || clubId || dept || year;
  const clearFilters = () => { setSearch(''); setClubId(''); setDept(''); setYear(''); setPage(1); };

  /* CSV export */
  const exportCSV = () => {
    const header = 'Name,Enrollment No,Email,Phone,Department,Year,Club,Joined';
    const rows   = members.map(m =>
      [m.name, m.enrollmentNo, m.email, m.phone, m.dept, m.year, m.club_name, fmtDate(m.joined_at)]
        .map(v => `"${String(v||'').replace(/"/g,'""')}"`)
        .join(',')
    );
    const blob = new Blob([[header,...rows].join('\n')], {type:'text/csv'});
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href:url, download:'club-members.csv' });
    a.click(); URL.revokeObjectURL(url);
  };

  /* stat counts */
  const uniqueClubs   = new Set(members.map(m => m.club_id)).size;
  const uniqueStudents= new Set(members.map(m => m.email)).size;

  return (
    <>
      {/* Stats strip */}
      {!loading && (
        <div className={s.statsStrip}>
          {[
            { n: pagination.total, l: 'Total Memberships', c: '#0f0a2e' },
            { n: uniqueStudents,   l: 'Unique Students',   c: '#635bff' },
            { n: uniqueClubs,      l: 'Clubs Represented', c: '#00c896' },
          ].map(({ n, l, c }) => (
            <div key={l} className={s.statBox}>
              <div className={s.statNum} style={{ color: c }}>{n}</div>
              <div className={s.statLabel}>{l}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter bar */}
      <div style={{
        background:'#fff', border:'1.5px solid #f0f0f5', borderRadius:12,
        padding:'14px 16px', marginBottom:18,
        display:'flex', gap:10, flexWrap:'wrap', alignItems:'center',
      }}>
        {/* Search */}
        <div style={{ position:'relative', flex:'1', minWidth:210 }}>
          <svg style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)', width:15, height:15, color:'#9ca3af', pointerEvents:'none' }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, enrollment no…"
            style={{ width:'100%', padding:'9px 32px 9px 33px', border:'1.5px solid #e5e7eb', borderRadius:9, fontSize:'.875rem', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:16 }}>✕</button>
          )}
        </div>

        {/* Club */}
        <select value={clubId} onChange={e => setClubId(e.target.value)}
          style={{ padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:9, fontSize:'.875rem', outline:'none', background:'#fff', cursor:'pointer', fontFamily:'inherit', flex:'1', minWidth:120 }}>
          <option value="">All Clubs</option>
          {clubs.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>

        {/* Department */}
        <select value={dept} onChange={e => setDept(e.target.value)}
          style={{ padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:9, fontSize:'.875rem', outline:'none', background:'#fff', cursor:'pointer', fontFamily:'inherit', flex:'1', minWidth:120 }}>
          <option value="">All Departments</option>
          {deptOpts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Year */}
        <select value={year} onChange={e => setYear(e.target.value)}
          style={{ padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:9, fontSize:'.875rem', outline:'none', background:'#fff', cursor:'pointer', fontFamily:'inherit', flex:'1', minWidth:90 }}>
          <option value="">All Years</option>
          {yearOpts.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        {hasFilters && (
          <button onClick={clearFilters} style={{ padding:'8px 14px', border:'1.5px solid #fca5a5', borderRadius:4, background:'#fff1f2', color:'#dc2626', fontSize:'.8rem', fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
            ✕ Clear
          </button>
        )}

        <button onClick={exportCSV} disabled={loading || !members.length}
          style={{ marginLeft:'auto', padding:'8px 14px', background:'#fff', border:'1.5px solid #e5e7eb', borderRadius:4, fontSize:'.82rem', fontWeight:600, color:'#374151', cursor:'pointer', opacity:(!members.length||loading)?.45:1 }}>
          ↓ Export CSV
        </button>
      </div>

      {error && <div className={s.errorBar}>{error}</div>}

      {/* Table */}
      {loading ? (
        <div className={s.tableCard}>{Array.from({length:6}).map((_,i) => <div key={i} className={s.skeletonRow}/>)}</div>
      ) : members.length === 0 ? (
        <div className={s.empty}>
          <p>{hasFilters ? 'No members match your filters' : 'No club memberships yet'}</p>
          {hasFilters && (
            <button onClick={clearFilters} style={{ marginTop:10, padding:'7px 16px', background:'#635BFF', color:'#fff', border:'none', borderRadius:4, cursor:'pointer', fontSize:'.82rem', fontWeight:600 }}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className={s.tableCard} style={{ overflowX:'auto' }}>
          <table className={s.table} style={{ minWidth:900 }}>
            <thead>
              <tr>
                <th style={{ width:36 }}>#</th>
                <th>Member</th>
                <th>Enrollment No</th>
                <th>Phone</th>
                <th>Department</th>
                <th>Year</th>
                <th>Club</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr key={`${m.id}-${i}`} onClick={() => setDetail(m)} style={{ cursor:'pointer' }} title="Click for full details">
                  <td className={s.tdHide} style={{ fontSize:'.75rem', color:'#9ca3af' }}>
                    {(page - 1) * PAGE_SIZE + i + 1}
                  </td>
                  <td data-label="">
                    <div style={{ display:'flex', alignItems:'center', gap:9 }}>
                      <div style={{ width:32, height:32, borderRadius:'50%', background:GRADS[i%GRADS.length], display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:'#fff', flexShrink:0 }}>
                        {initials(m.name)}
                      </div>
                      <div>
                        <div style={{ fontSize:'.875rem', fontWeight:600, color:'#0f0a2e' }}>{m.name}</div>
                        <div style={{ fontSize:'.75rem', color:'#9ca3af' }}>{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Enroll.">
                    <span style={{ fontFamily:'monospace', fontSize:'.8rem', background:'#f5f3ff', color:'#6d28d9', padding:'2px 8px', borderRadius:6, fontWeight:600 }}>
                      {m.enrollmentNo || '—'}
                    </span>
                  </td>
                  <td data-label="Phone" className={s.muted}>{m.phone || '—'}</td>
                  <td data-label="Dept">
                    {m.dept
                      ? <span style={{ background:'#f0f9ff', color:'#0369a1', padding:'2px 9px', borderRadius:6, fontSize:'.78rem', fontWeight:600 }}>{m.dept}</span>
                      : <span className={s.muted}>—</span>}
                  </td>
                  <td data-label="Year">
                    {m.year
                      ? <span style={{ background:'#f0fdf4', color:'#15803d', padding:'2px 9px', borderRadius:6, fontSize:'.78rem', fontWeight:600 }}>{m.year}</span>
                      : <span className={s.muted}>—</span>}
                  </td>
                  <td data-label="Club">
                    <span style={{ background:'#faf5ff', color:'#7c3aed', padding:'2px 9px', borderRadius:6, fontSize:'.78rem', fontWeight:600 }}>
                      {m.club_name}
                    </span>
                  </td>
                  <td data-label="Joined" className={s.muted} style={{ whiteSpace:'nowrap' }}>{fmtDate(m.joined_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginTop:20 }}>
          <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page<=1}
            style={{ padding:'7px 14px', border:'1.5px solid #e5e7eb', borderRadius:8, background:'#fff', cursor:page<=1?'not-allowed':'pointer', opacity:page<=1?.45:1, fontSize:'.82rem', fontWeight:600 }}>
            ← Prev
          </button>
          {Array.from({ length: Math.min(7, pagination.pages) }, (_, i) => {
            let p;
            if (pagination.pages <= 7) p = i + 1;
            else if (page <= 4) p = i + 1;
            else if (page >= pagination.pages - 3) p = pagination.pages - 6 + i;
            else p = page - 3 + i;
            return (
              <button key={p} onClick={() => setPage(p)}
                style={{ padding:'7px 12px', border:`1.5px solid ${p===page?'#635BFF':'#e5e7eb'}`, borderRadius:8, background:p===page?'#635BFF':'#fff', color:p===page?'#fff':'#374151', cursor:'pointer', fontWeight:600, fontSize:'.82rem', minWidth:36 }}>
                {p}
              </button>
            );
          })}
          <button onClick={() => setPage(p => Math.min(pagination.pages, p+1))} disabled={page>=pagination.pages}
            style={{ padding:'7px 14px', border:'1.5px solid #e5e7eb', borderRadius:8, background:'#fff', cursor:page>=pagination.pages?'not-allowed':'pointer', opacity:page>=pagination.pages?.45:1, fontSize:'.82rem', fontWeight:600 }}>
            Next →
          </button>
          <span style={{ fontSize:'.78rem', color:'#9ca3af', marginLeft:4, whiteSpace:'nowrap' }}>
            {page}/{pagination.pages} · {pagination.total}
          </span>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div style={{ position:'fixed', inset:0, background:'rgba(15,10,46,.55)', backdropFilter:'blur(4px)', zIndex:300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={() => setDetail(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:18, width:'100%', maxWidth:500, boxShadow:'0 24px 64px rgba(0,0,0,.22)', overflow:'hidden' }}>
            {/* header */}
            <div style={{ background:'linear-gradient(135deg,#635BFF,#a78bfa)', padding:'20px 22px', display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ width:50, height:50, borderRadius:'50%', background:'rgba(255,255,255,.25)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:700, color:'#fff', flexShrink:0 }}>
                {initials(detail.name)}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:16, fontWeight:700, color:'#fff' }}>{detail.name}</div>
                <div style={{ fontSize:12, color:'rgba(255,255,255,.75)', marginTop:2 }}>{detail.email}</div>
              </div>
              <button onClick={() => setDetail(null)}
                style={{ background:'rgba(255,255,255,.2)', border:'none', color:'#fff', width:30, height:30, borderRadius:8, cursor:'pointer', fontSize:14 }}>✕</button>
            </div>
            {/* body */}
            <div className={s.detailGrid} style={{ padding:'20px 22px' }}>
              {[
                { label:'Enrollment No', value: detail.enrollmentNo || '—', mono: true },
                { label:'Phone',         value: detail.phone        || '—' },
                { label:'Department',    value: detail.dept         || '—' },
                { label:'Year',          value: detail.year         || '—' },
                { label:'Club',          value: detail.club_name    || '—' },
                { label:'Joined',        value: fmtDate(detail.joined_at) },
              ].map(({ label, value, mono }) => (
                <div key={label}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:3 }}>{label}</div>
                  <div style={{ fontSize:14, fontWeight:600, color:'#0f0a2e', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
                </div>
              ))}
              {detail.message && (
                <div style={{ gridColumn:'1 / -1' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:3 }}>Join Message</div>
                  <div style={{ fontSize:13, color:'#374151', lineHeight:1.5, background:'#f9f9fb', borderRadius:8, padding:'10px 12px', fontStyle:'italic' }}>"{detail.message}"</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROOT — tab switcher
═══════════════════════════════════════════════════════════════════════════ */
export default function AdminMembers() {
  const [tab,   setTab]   = useState('users');
  const [clubs, setClubs] = useState([]);

  useEffect(() => {
    api.get('/clubs?limit=200').then(d => setClubs(d.clubs || [])).catch(() => {});
  }, []);

  const tabStyle = active => ({
    padding: '9px 20px',
    border: 'none',
    borderBottom: `2.5px solid ${active ? '#635BFF' : 'transparent'}`,
    background: 'transparent',
    color: active ? '#635BFF' : '#6b7280',
    fontSize: '.875rem',
    fontWeight: active ? 700 : 500,
    cursor: 'pointer',
    transition: 'all .15s',
    fontFamily: 'inherit',
  });

  return (
    <div className={s.page}>
      {/* Header */}
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Members</h1>
          <p className={s.sub}>
            {tab === 'users' ? 'All system accounts — admins, coordinators, students' : 'All student club memberships with full registration info'}
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display:'flex', borderBottom:'1.5px solid #f0f0f5', marginBottom:24, gap:24 }}>
        <button style={tabStyle(tab === 'users')}   onClick={() => setTab('users')}>
          Users
        </button>
        <button style={tabStyle(tab === 'members')} onClick={() => setTab('members')}>
          Club Members
        </button>
      </div>

      {tab === 'users'
        ? <UsersTab clubs={clubs} />
        : <ClubMembersTab clubs={clubs} />
      }
    </div>
  );
}
