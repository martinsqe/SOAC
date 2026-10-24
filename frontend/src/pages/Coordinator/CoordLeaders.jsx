import { useState, useEffect, useCallback, useRef } from 'react';
import { useCoordClub } from '../../context/CoordClubContext';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import s from './CoordLeaders.module.css';

/* The common roles, picked from the dropdown; "Other role…" lets the Faculty
   Advisor type any other one */
const COMMON_ROLES = ['Convener', 'Coordinator', 'Treasurer'];
const OTHER = '__other__';

function RolePicker({ value, onChange, onEnter, autoFocus }) {
  const [other, setOther] = useState(() => !!value && !COMMON_ROLES.includes(value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <select className={s.input} autoFocus={autoFocus && !other}
        value={other ? OTHER : (COMMON_ROLES.includes(value) ? value : '')}
        onChange={e => {
          if (e.target.value === OTHER) { setOther(true); onChange(''); }
          else { setOther(false); onChange(e.target.value); }
        }}>
        <option value="" disabled>Choose a role…</option>
        {COMMON_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        <option value={OTHER}>Other role…</option>
      </select>
      {other && (
        <input className={s.input} value={value} maxLength={100} autoFocus placeholder="Type the role, e.g. Secretary"
          onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter(); }} />
      )}
    </div>
  );
}

const initials = (name = '') => name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';

/* Search a club member by name, email or enrollment number; picking one fills in
   all their details (like adding volunteers to a report) — only the role is typed. */
function AssignRow({ clubId, leadership, onAssigned, showToast }) {
  const [query, setQuery]       = useState('');
  const [results, setResults]   = useState([]);
  const [searching, setSearching] = useState(false);
  const [member, setMember]     = useState(null);
  const [role, setRole]         = useState('');
  const [saving, setSaving]     = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (member || q.length < 2) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      setSearching(true);
      api.get(`/clubs/${clubId}/members?search=${encodeURIComponent(q)}&limit=8`)
        .then(d => { if (alive) setResults((d.members || []).filter(m => m.membershipActive !== false)); })
        .catch(() => { if (alive) setResults([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [query, clubId, member]);

  const rolesOf = (userId) => leadership.filter(l => l.user_id === userId).map(l => l.role_title);
  const pick = (m) => { setMember(m); setQuery(''); setResults([]); };
  const clear = () => { setMember(null); setRole(''); };

  const assign = async () => {
    if (!member || !role.trim()) return;
    setSaving(true);
    try {
      const d = await api.post(`/clubs/${clubId}/leadership/assign`, { userId: member.id, roleTitle: role.trim() });
      onAssigned(d.leadership || []);
      showToast(`${member.name} is now ${role.trim()} — they and the club members have been notified.`);
      clear();
    } catch (err) { showToast(err.message || 'Could not assign the role.'); }
    finally { setSaving(false); }
  };

  return (
    <div className={s.assignBox}>
      <div className={s.assignTitle}>Assign a role</div>
      {!member ? (
        <div style={{ position: 'relative' }}>
          <input className={s.input} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search a club member by name, email or enrollment no.…" />
          {query.trim().length >= 2 && (
            <div className={s.results}>
              {searching && <div className={s.resultNote}>Searching…</div>}
              {!searching && results.length === 0 && <div className={s.resultNote}>No active member matches “{query.trim()}”.</div>}
              {results.map(m => (
                <button key={m.id} type="button" className={s.result} onClick={() => pick(m)}>
                  <span className={s.resultName}>{m.name}</span>
                  <span className={s.resultMeta}>
                    {[m.enrollmentNo, m.dept, m.year, m.email].filter(Boolean).join(' · ')}
                    {rolesOf(m.id).length > 0 && <> · <strong>{rolesOf(m.id).join(', ')}</strong></>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr><th>Member</th><th>Enrollment</th><th>Department / Year</th><th>Phone</th><th>Role</th><th></th></tr>
            </thead>
            <tbody>
              <tr>
                <td><div className={s.cellName}>{member.name}</div><div className={s.cellSub}>{member.email}</div></td>
                <td>{member.enrollmentNo || '—'}</td>
                <td>{[member.dept, member.year].filter(Boolean).join(' · ') || '—'}</td>
                <td>{member.phone || '—'}</td>
                <td style={{ minWidth: 180 }}>
                  <RolePicker value={role} onChange={setRole} onEnter={assign} autoFocus />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className={s.primaryBtn} onClick={assign} disabled={saving || !role.trim()}>
                    {saving ? 'Assigning…' : 'Assign'}
                  </button>
                  <button className={s.ghostBtn} onClick={clear} style={{ marginLeft: 6 }}>Cancel</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* Edit one role: role title, phone, responsibilities and the photo */
function EditModal({ clubId, leader, onClose, onSaved, showToast }) {
  const [role, setRole]   = useState(leader.role_title || '');
  const [phone, setPhone] = useState(leader.phone || '');
  const [resp, setResp]   = useState(leader.responsibilities || '');
  const [file, setFile]   = useState(null);
  const [preview, setPreview] = useState(leader.photo_url || '');
  const [removePhoto, setRemovePhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => () => { if (file) URL.revokeObjectURL(preview); }, [file, preview]);

  const choose = (f) => { if (!f) return; setFile(f); setPreview(URL.createObjectURL(f)); setRemovePhoto(false); };
  const dropPhoto = () => { setFile(null); setPreview(''); setRemovePhoto(true); if (fileRef.current) fileRef.current.value = ''; };

  const save = async () => {
    if (!role.trim()) { showToast('The role cannot be empty.'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('roleTitle', role.trim());
      fd.append('phone', phone.trim());
      fd.append('responsibilities', resp.trim());
      if (file) fd.append('photo', file);
      else if (removePhoto) fd.append('removePhoto', '1');
      const d = await api.patchForm(`/clubs/${clubId}/leadership/${leader.id}`, fd);
      onSaved(d.leadership || []);
      showToast('Role updated.');
      onClose();
    } catch (err) { showToast(err.message || 'Could not save.'); }
    finally { setSaving(false); }
  };

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <div>
            <div className={s.modalTag}>Edit role</div>
            <h2 className={s.modalTitle}>{leader.holder_name}</h2>
          </div>
          <button className={s.closeBtn} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={s.photoRow}>
          <div className={s.photoBox}>
            {preview ? <img src={preview} alt="" /> : <span>{initials(leader.holder_name)}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button type="button" className={s.ghostBtn} onClick={() => fileRef.current?.click()}>
              {preview ? 'Change photo' : 'Upload photo'}
            </button>
            {preview && <button type="button" className={s.dangerBtn} onClick={dropPhoto}>Remove photo</button>}
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => choose(e.target.files[0])} />
          </div>
        </div>

        <label className={s.label}>Role</label>
        <RolePicker value={role} onChange={setRole} />

        <label className={s.label}>Phone / WhatsApp</label>
        <input className={s.input} value={phone} maxLength={50} onChange={e => setPhone(e.target.value)} />

        <label className={s.label}>Roles &amp; responsibilities</label>
        <textarea className={s.input} rows={3} value={resp} onChange={e => setResp(e.target.value)}
          placeholder="e.g. Manages club finances, chairs weekly meetings…" style={{ resize: 'vertical', lineHeight: 1.5 }} />

        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button className={s.ghostBtn} onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className={s.primaryBtn} onClick={save} disabled={saving} style={{ flex: 2 }}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export default function CoordLeaders() {
  const { club } = useCoordClub();
  const { user } = useAuth();
  const clubId   = club?._id || null;
  const isFA     = user?.role === 'faculty_coordinator';

  const [leadership, setLeadership] = useState([]);
  const [staff, setStaff]           = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [editing, setEditing]       = useState(null);
  const [removingId, setRemovingId] = useState(null);
  const [toast, setToast]           = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 4000); };

  const loadData = useCallback(() => {
    if (!clubId) return;
    setLoading(true);
    api.get(`/clubs/${clubId}/leadership`)
      .then(d => { setLeadership(d.leadership || []); setStaff(d.staff || []); setError(''); })
      .catch(err => setError(err.message || 'Could not load leadership data.'))
      .finally(() => setLoading(false));
  }, [clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  const remove = async (l) => {
    if (!window.confirm(`Remove ${l.holder_name || 'this member'} as ${l.role_title}?`)) return;
    setRemovingId(l.id);
    try {
      const d = await api.delete(`/clubs/${clubId}/leadership/${l.id}`);
      setLeadership(d.leadership || []);
      showToast('Role removed.');
    } catch (err) { showToast(err.message || 'Could not remove the role.'); }
    finally { setRemovingId(null); }
  };

  return (
    <div className={s.page}>
      {toast && <div className={s.toast}>{toast}</div>}

      <div className={s.header}>
        <div>
          <h1 className={s.title}>Leadership Team</h1>
          <p className={s.sub}>
            {isFA
              ? 'Search a member and give them a role. They, and every club member, are told by email and notification.'
              : 'Only the Faculty Advisor assigns leadership roles.'}
          </p>
        </div>
      </div>

      {error && <div className={s.errBox}>{error}</div>}

      {/* Faculty Advisor and Student Coordinators — assigned separately, with dashboard access */}
      <div className={s.section}>
        <div className={s.sectionTitle}>Club staff</div>
        <div className={s.staffRow}>
          {staff.length === 0 && !loading && <span className={s.muted}>No Faculty Advisor or Student Coordinator assigned yet.</span>}
          {staff.map(p => (
            <div key={p.id} className={s.staffCard}>
              <div className={s.staffAv}>{p.avatar ? <img src={p.avatar} alt="" /> : initials(p.name)}</div>
              <div style={{ minWidth: 0 }}>
                <div className={s.cellName}>{p.name}</div>
                <div className={s.cellSub}>{p.email}</div>
                <div className={s.staffTags}>
                  <span className={s.roleTag}>{p.role === 'Student Coordinator' ? 'Convener' : p.role}</span>
                  <span className={s.assignedTag}>Assigned · dashboard access</span>
                </div>
              </div>
            </div>
          ))}
        </div>
        {isFA && <p className={s.hint}>Conveners are assigned from “Assign Convener” at the bottom of the sidebar.</p>}
      </div>

      {isFA && clubId && <AssignRow clubId={clubId} leadership={leadership} onAssigned={setLeadership} showToast={showToast} />}

      <div className={s.section}>
        <div className={s.sectionTitle}>Roles ({leadership.length})</div>
        {loading ? (
          <div className={s.muted}>Loading…</div>
        ) : leadership.length === 0 ? (
          <div className={s.emptyState}>
            <div className={s.emptyTitle}>No roles assigned yet</div>
            <p className={s.emptySub}>{isFA ? 'Search a member above to assign the first role — Convener, Treasurer and so on.' : 'The Faculty Advisor has not assigned any roles yet.'}</p>
          </div>
        ) : (
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Member</th><th>Enrollment</th><th>Department / Year</th><th>Phone</th><th>Role</th>
                  {isFA && <th></th>}
                </tr>
              </thead>
              <tbody>
                {leadership.map(l => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div className={s.rowAv}>{l.photo_url ? <img src={l.photo_url} alt="" /> : initials(l.holder_name || l.role_title)}</div>
                        <div style={{ minWidth: 0 }}>
                          <div className={s.cellName}>{l.holder_name || <span className={s.muted}>Vacant</span>}</div>
                          {l.holder_email && <div className={s.cellSub}>{l.holder_email}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{l.enrollment_no || '—'}</td>
                    <td>{[l.dept, l.year].filter(Boolean).join(' · ') || '—'}</td>
                    <td>{l.phone || '—'}</td>
                    <td><span className={s.roleTag}>{l.role_title}</span></td>
                    {isFA && (
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <button className={s.ghostBtn} onClick={() => setEditing(l)}>Edit</button>
                        <button className={s.dangerBtn} onClick={() => remove(l)} disabled={removingId === l.id} style={{ marginLeft: 6 }}>
                          {removingId === l.id ? 'Removing…' : 'Remove'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <EditModal clubId={clubId} leader={editing} onClose={() => setEditing(null)} onSaved={setLeadership} showToast={showToast} />
      )}
    </div>
  );
}
