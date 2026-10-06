import { useEffect, useState } from 'react';
import api from '../../api/client';

/* Volunteers for the event report, picked from the member list: search a name,
   click it, and their details fill in — only the role is typed. Members picked
   here are thanked by email and in-app, and get "Volunteer of <event>" in their
   activity, once the report is submitted to the admin.
     clubId  the event's club (its members are searched); none → admin searches
             every club's members (non-club events) */
export default function VolunteerPicker({ volunteers = [], onChange, clubId, disabled }) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return undefined; // results only show from 2 characters
    let alive = true;
    const t = setTimeout(() => {
      setSearching(true);
      const url = clubId
        ? `/clubs/${clubId}/members?search=${encodeURIComponent(q)}&limit=8`
        : `/clubs/members?search=${encodeURIComponent(q)}&limit=8`;
      api.get(url)
        .then(d => { if (alive) { setResults(d.members || []); setSearchError(''); } })
        .catch(err => { if (alive) { setResults([]); setSearchError(err.message || 'Search failed.'); } })
        .finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, clubId]);

  const picked = new Set(volunteers.map(v => (v.email || '').toLowerCase()).filter(Boolean));
  const add = (m) => {
    if (picked.has((m.email || '').toLowerCase())) return;
    onChange([...volunteers, {
      name: m.name || '', enrollment: m.enrollmentNo || '', dept: m.dept || '',
      email: m.email || '', user_id: m.id || null, role: '',
    }]);
    setQuery('');
    setResults([]);
  };
  const update = (i, patch) => onChange(volunteers.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const remove = (i) => onChange(volunteers.filter((_, j) => j !== i));
  const addManual = () => onChange([...volunteers, { name: '', enrollment: '', dept: '', email: '', user_id: null, role: '' }]);

  const input = {
    width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7,
    border: '1.5px solid #e5e7eb', fontSize: '.82rem', fontFamily: 'inherit', background: '#fff',
  };
  const cell = { fontSize: '.82rem', color: '#1f2937', overflowWrap: 'anywhere' };

  return (
    <div>
      {!disabled && (
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <input style={input} value={query} onChange={e => setQuery(e.target.value)}
            placeholder={clubId ? 'Search club members by name, email or enrollment no.…' : 'Search members by name, email or enrollment no.…'} />
          {query.trim().length >= 2 && (
            <div style={{ position: 'absolute', zIndex: 20, left: 0, right: 0, top: '100%', marginTop: 4, background: '#fff',
              border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 10px 28px rgba(15,10,46,.14)', maxHeight: 280, overflowY: 'auto' }}>
              {searching && <div style={{ padding: '10px 12px', fontSize: '.8rem', color: '#6b7280' }}>Searching…</div>}
              {!searching && searchError && <div style={{ padding: '10px 12px', fontSize: '.8rem', color: '#b91c1c' }}>{searchError}</div>}
              {!searching && !searchError && results.length === 0 && (
                <div style={{ padding: '10px 12px', fontSize: '.8rem', color: '#6b7280' }}>No members match "{query.trim()}".</div>
              )}
              {!searching && results.map(m => {
                const already = picked.has((m.email || '').toLowerCase());
                return (
                  <button key={`${m.id}-${m.club_id || ''}`} type="button" disabled={already} onClick={() => add(m)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', borderBottom: '1px solid #f3f4f6',
                      background: already ? '#f9fafb' : '#fff', cursor: already ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                    <div style={{ fontWeight: 700, fontSize: '.84rem', color: already ? '#9ca3af' : '#1f1a4d' }}>
                      {m.name}{already ? ' — added' : ''}
                    </div>
                    <div style={{ fontSize: '.74rem', color: '#6b7280' }}>
                      {[m.enrollmentNo, m.dept, m.year, m.email].filter(Boolean).join(' · ')}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {volunteers.length > 0 ? (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '28px 1.4fr 1fr 0.8fr 1.4fr 70px', gap: 8, padding: '7px 10px',
            background: '#f9fafb', fontSize: '.72rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.03em' }}>
            <span>#</span><span>Name</span><span>Enrollment</span><span>Dept</span><span>Role</span><span />
          </div>
          {volunteers.map((v, i) => {
            const fromList = !!v.email;
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 1.4fr 1fr 0.8fr 1.4fr 70px', gap: 8, padding: '7px 10px',
                alignItems: 'center', borderTop: '1px solid #f3f4f6' }}>
                <span style={{ ...cell, color: '#6b7280' }}>{i + 1}</span>
                {fromList ? (<>
                  <span style={{ ...cell, fontWeight: 700 }}>{v.name}<span style={{ display: 'block', fontWeight: 400, fontSize: '.72rem', color: '#6b7280' }}>{v.email}</span></span>
                  <span style={cell}>{v.enrollment || '—'}</span>
                  <span style={cell}>{v.dept || '—'}</span>
                </>) : (<>
                  <input style={input} placeholder="Name" value={v.name} maxLength={100} disabled={disabled} onChange={e => update(i, { name: e.target.value })} />
                  <input style={input} placeholder="Enrollment" value={v.enrollment} maxLength={40} disabled={disabled} onChange={e => update(i, { enrollment: e.target.value })} />
                  <input style={input} placeholder="Dept" value={v.dept} maxLength={60} disabled={disabled} onChange={e => update(i, { dept: e.target.value })} />
                </>)}
                <input style={input} placeholder="Role, e.g. Registration desk" value={v.role || ''} maxLength={100} disabled={disabled}
                  onChange={e => update(i, { role: e.target.value })} />
                {!disabled ? (
                  <button type="button" onClick={() => remove(i)}
                    style={{ border: '1px solid #fecaca', background: '#fff5f5', color: '#dc2626', borderRadius: 7, padding: '6px 0', fontSize: '.74rem', fontWeight: 700, cursor: 'pointer' }}>
                    Remove
                  </button>
                ) : <span />}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ fontSize: '.8rem', color: '#9ca3af', padding: '6px 0' }}>No volunteers added yet.</div>
      )}

      {!disabled && (
        <button type="button" onClick={addManual}
          style={{ marginTop: 8, border: 'none', background: 'none', color: '#635BFF', fontSize: '.78rem', fontWeight: 700, cursor: 'pointer', padding: 0 }}>
          + Add someone who isn't in the member list
        </button>
      )}
    </div>
  );
}
