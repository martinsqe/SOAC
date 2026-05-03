import { useState, useEffect, useCallback, useRef } from 'react';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import s from './CoordSubPage.module.css';

/* ── gradient avatars ── */
const GRADS = [
  'linear-gradient(135deg,#3DDC84,#635BFF)',
  'linear-gradient(135deg,#FF6B35,#FFD166)',
  'linear-gradient(135deg,#A259FF,#3DDC84)',
  'linear-gradient(135deg,#06D6A0,#00E5FF)',
  'linear-gradient(135deg,#FF6B9D,#FF9500)',
  'linear-gradient(135deg,#635BFF,#A259FF)',
  'linear-gradient(135deg,#00C896,#00AADD)',
  'linear-gradient(135deg,#FFD166,#FF6B35)',
];

const initials = (name = '') =>
  name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── debounce hook ── */
function useDebounce(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const PAGE_SIZE = 20;

export default function CoordMembers() {
  const { club }                  = useCoordClub();
  const clubRef                   = useRef(null);
  const [members,    setMembers]    = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  /* filter state */
  const [search,   setSearch]   = useState('');
  const [dept,     setDept]     = useState('');
  const [year,     setYear]     = useState('');
  const [page,     setPage]     = useState(1);

  /* option lists built from first unfiltered load */
  const [deptOpts, setDeptOpts] = useState([]);
  const [yearOpts, setYearOpts] = useState([]);

  /* detail modal */
  const [detail, setDetail] = useState(null);

  const debouncedSearch = useDebounce(search);

  /* keep ref in sync with context club */
  useEffect(() => { clubRef.current = club; }, [club]);

  /* load members whenever filters / page change */
  const load = useCallback(() => {
    const c = clubRef.current;
    if (!c) return;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page, limit: PAGE_SIZE });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (dept)            params.set('dept',   dept);
    if (year)            params.set('year',   year);

    api.get(`/clubs/${c._id}/members?${params}`)
      .then(({ members: list, pagination: pg }) => {
        setMembers(list || []);
        setPagination(pg || { page: 1, total: 0, pages: 1 });
        if (!debouncedSearch && !dept && !year && page === 1) {
          setDeptOpts([...new Set(list.map(m => m.dept).filter(Boolean))].sort());
          setYearOpts([...new Set(list.map(m => m.year).filter(Boolean))].sort());
        }
      })
      .catch(err => setError(err.message || 'Failed to load members'))
      .finally(() => setLoading(false));
  }, [debouncedSearch, dept, year, page]);

  /* trigger load when club arrives or filters change */
  useEffect(() => { if (club) load(); }, [club, load]);

  /* reset page when filters change */
  useEffect(() => { setPage(1); }, [debouncedSearch, dept, year]);

  const clearFilters = () => { setSearch(''); setDept(''); setYear(''); setPage(1); };
  const hasFilters   = search || dept || year;

  /* ── CSV export ── */
  const exportCSV = () => {
    const header = 'Name,Enrollment No,Email,Phone,Department,Year,Club,Joined';
    const rows   = members.map(m =>
      [m.name, m.enrollmentNo, m.email, m.phone, m.dept, m.year, m.club_name, fmt(m.joined_at)]
        .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
        .join(',')
    );
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `${club?.name || 'club'}-members.csv` });
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className={s.page}>

      {/* ── Header ── */}
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Members</h1>
          <p className={s.sub}>
            {loading
              ? 'Loading…'
              : club
                ? `${pagination.total} member${pagination.total !== 1 ? 's' : ''} · ${club.name}`
                : 'No club assigned'}
          </p>
        </div>
        <button
          onClick={exportCSV}
          disabled={loading || !members.length}
          style={{
            padding: '8px 16px', background: '#fff', border: '1.5px solid #e5e7eb',
            borderRadius: 4, fontSize: '.82rem', fontWeight: 600, color: '#374151',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            opacity: (!members.length || loading) ? .45 : 1,
          }}
        >
          ↓ Export CSV
        </button>
      </div>

      {/* ── Filter bar ── */}
      <div style={{
        background: '#fff', border: '1.5px solid #f0f0f5', borderRadius: 4,
        padding: '14px 16px', marginBottom: 18,
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1', minWidth: 200 }}>
          <svg style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', width: 15, height: 15, color: '#9ca3af', pointerEvents: 'none' }}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, email, enrollment no…"
            style={{
              width: '100%', padding: '9px 12px 9px 33px', border: '1.5px solid #e5e7eb',
              borderRadius: 4, fontSize: '.875rem', outline: 'none', boxSizing: 'border-box',
              fontFamily: 'inherit',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', fontSize: 16,
            }}>✕</button>
          )}
        </div>

        {/* Department */}
        <select
          value={dept}
          onChange={e => setDept(e.target.value)}
          style={{ padding: '9px 12px', border: '1.5px solid #e5e7eb', borderRadius: 9, fontSize: '.875rem', outline: 'none', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <option value="">All Departments</option>
          {deptOpts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Year */}
        <select
          value={year}
          onChange={e => setYear(e.target.value)}
          style={{ padding: '9px 12px', border: '1.5px solid #e5e7eb', borderRadius: 9, fontSize: '.875rem', outline: 'none', background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          <option value="">All Years</option>
          {yearOpts.map(y => <option key={y} value={y}>{y}</option>)}
        </select>

        {hasFilters && (
          <button onClick={clearFilters} style={{
            padding: '8px 14px', border: '1.5px solid #fca5a5', borderRadius: 4,
            background: '#fff1f2', color: '#dc2626', fontSize: '.8rem', fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            ✕ Clear
          </button>
        )}

        {hasFilters && !loading && (
          <span style={{ fontSize: '.8rem', color: '#6b7280', marginLeft: 'auto' }}>
            {pagination.total} result{pagination.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', padding: '10px 14px', borderRadius: 4, fontSize: '.85rem', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className={s.tableCard} style={{ padding: 12 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={s.shimmer} style={{ height: 52, borderRadius: 8, marginBottom: 6 }} />
          ))}
        </div>
      ) : members.length === 0 ? (
        <div className={s.empty}>
          <p>{hasFilters ? 'No members match your filters' : 'No members yet'}</p>
          {hasFilters && <button onClick={clearFilters} style={{ marginTop: 10, padding: '7px 16px', background: '#635BFF', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '.82rem', fontWeight: 600 }}>Clear filters</button>}
        </div>
      ) : (
        <div className={s.tableCard} style={{ overflowX: 'auto' }}>
          <table className={s.table} style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Member</th>
                <th>Enrollment No</th>
                <th>Phone</th>
                <th>Department</th>
                <th>Year</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m, i) => (
                <tr
                  key={`${m.id}-${i}`}
                  onClick={() => setDetail(m)}
                  style={{ cursor: 'pointer' }}
                  title="Click to view full details"
                >
                  <td className={s.muted} style={{ fontSize: '.75rem' }}>
                    {(page - 1) * PAGE_SIZE + i + 1}
                  </td>
                  <td>
                    <div className={s.memberCell}>
                      <div className={s.av} style={{ background: GRADS[i % GRADS.length] }}>
                        {initials(m.name)}
                      </div>
                      <div>
                        <div className={s.mName}>{m.name}</div>
                        <div className={s.mMeta}>{m.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span style={{
                      fontFamily: 'monospace', fontSize: '.8rem',
                      background: '#f5f3ff', color: '#6d28d9',
                      padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                    }}>
                      {m.enrollmentNo || '—'}
                    </span>
                  </td>
                  <td className={s.muted}>{m.phone || '—'}</td>
                  <td>
                    {m.dept
                      ? <span style={{ background: '#f0f9ff', color: '#0369a1', padding: '2px 9px', borderRadius: 4, fontSize: '.78rem', fontWeight: 600 }}>{m.dept}</span>
                      : <span className={s.muted}>—</span>}
                  </td>
                  <td>
                    {m.year
                      ? <span style={{ background: '#f0fdf4', color: '#15803d', padding: '2px 9px', borderRadius: 4, fontSize: '.78rem', fontWeight: 600 }}>{m.year}</span>
                      : <span className={s.muted}>—</span>}
                  </td>
                  <td className={s.muted} style={{ whiteSpace: 'nowrap' }}>{fmt(m.joined_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {pagination.pages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
            style={{ padding: '7px 14px', border: '1.5px solid #e5e7eb', borderRadius: 4, background: '#fff', cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? .45 : 1, fontSize: '.82rem', fontWeight: 600 }}>
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
                style={{ padding: '7px 12px', border: `1.5px solid ${p === page ? '#635BFF' : '#e5e7eb'}`, borderRadius: 4, background: p === page ? '#635BFF' : '#fff', color: p === page ? '#fff' : '#374151', cursor: 'pointer', fontWeight: 600, fontSize: '.82rem', minWidth: 36 }}>
                {p}
              </button>
            );
          })}
          <button onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages}
            style={{ padding: '7px 14px', border: '1.5px solid #e5e7eb', borderRadius: 4, background: '#fff', cursor: page >= pagination.pages ? 'not-allowed' : 'pointer', opacity: page >= pagination.pages ? .45 : 1, fontSize: '.82rem', fontWeight: 600 }}>
            Next →
          </button>
          <span style={{ fontSize: '.78rem', color: '#9ca3af', marginLeft: 4 }}>
            Page {page} of {pagination.pages}
          </span>
        </div>
      )}

      {/* ── Detail modal ── */}
      {detail && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,10,46,.55)', backdropFilter: 'blur(4px)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setDetail(null)}
        >
                      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 4, width: '100%', maxWidth: 480, boxShadow: '0 24px 64px rgba(0,0,0,.22)', overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(135deg,#4c44e0,#6b3fa0)', padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                  {initials(detail.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{detail.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,.75)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail.email}</div>
                </div>
                <button onClick={() => setDetail(null)} style={{ background: 'rgba(255,255,255,.2)', border: 'none', color: '#fff', width: 30, height: 30, borderRadius: 4, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
              </div>
              <div style={{ padding: '20px 22px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 20px' }}>
                {[
                  { label: 'Enrollment No', value: detail.enrollmentNo || '—', mono: true },
                  { label: 'Phone',         value: detail.phone        || '—' },
                  { label: 'Department',    value: detail.dept         || '—' },
                  { label: 'Year',          value: detail.year         || '—' },
                  { label: 'Club',          value: detail.club_name    || '—' },
                  { label: 'Joined',        value: fmt(detail.joined_at) },
                ].map(({ label, value, mono }) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f0a2e', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
                  </div>
                ))}
                {detail.message && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }}>Join Message</div>
                    <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5, background: '#f9f9fb', borderRadius: 4, padding: '10px 12px', fontStyle: 'italic' }}>"{detail.message}"</div>
                  </div>
                )}
              </div>
            </div>
        </div>
      )}
    </div>
  );
}
