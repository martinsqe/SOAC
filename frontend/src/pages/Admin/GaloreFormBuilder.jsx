/* Galore form builders (main coordinator, Galore portal):
     GaloreFormBuilder          Manage event → Galore form: categories, activities,
                                each one's club, individual / duo / team + players, guidelines
     GaloreCoordinatorsBuilder  Coordinators page: departments + their coordinators,
                                each activity's coordinator
   People are typed in by name + email — each gets a Galore portal login.
   Students then register through exactly this form. */

import { useState, useRef } from 'react';
import api from '../../api/client';
import { blankActivity, blankCategory, blankDepartment } from '../../utils/galoreForm';
import { uploadGuidelines, GUIDELINES_ACCEPT } from '../../utils/guidelinesFile';

/* Guidelines file (PDF / Word / image) — uploaded straight away; the
   returned link is kept on the activity (or the event) until the form is saved.
   Students see it in the Galore portal. */
/* default: the admin's upload; the Galore portal passes its own */
const adminUpload = async (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.postForm('/events/galore/rules-upload', fd);
};

function RulesUpload({ url, name, onChange, label = 'Upload guidelines', upload = adminUpload }) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const ref = useRef();
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setErr('');
    try { onChange(await uploadGuidelines(upload, f)); }
    catch (ex) { setErr(ex.message || 'Upload failed — please try again.'); }
    finally { setBusy(false); }
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: '.78rem', minWidth: 0 }}>
      {url ? (
        <>
          <span style={{ color: '#047857', fontWeight: 700 }} aria-hidden="true">✓</span>
          <a href={url} target="_blank" rel="noreferrer" title={name || 'Guidelines'}
            style={{ color: '#047857', fontWeight: 600, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name || 'Guidelines'}</a>
          <button type="button" onClick={() => ref.current.click()} disabled={busy} style={linkBtn}>{busy ? 'Uploading…' : 'Replace'}</button>
          <button type="button" onClick={() => { setErr(''); onChange({ rulesUrl: '', rulesName: '' }); }} disabled={busy} style={{ ...linkBtn, color: '#9ca3af' }}>Remove</button>
        </>
      ) : (
        <button type="button" onClick={() => ref.current.click()} disabled={busy} style={{ ...addBtn, padding: '5px 10px' }}>
          {busy ? 'Uploading…' : label}
        </button>
      )}
      <input ref={ref} type="file" accept={GUIDELINES_ACCEPT} style={{ display: 'none' }} onChange={pick} />
      {!url && !busy && !err && <span style={{ color: '#9ca3af' }}>PDF, Word or image · up to 15 MB</span>}
      {err && <span style={{ color: '#dc2626', flexBasis: '100%' }}>{err}</span>}
    </span>
  );
}


const sectionBox  = { background: '#f9fafb', border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '14px 16px' };
const sectionHead = { fontSize: '.78rem', fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 };
const sectionHint = { fontSize: '.76rem', color: '#9ca3af', margin: '0 0 12px' };
const input       = (bad) => ({ padding: '7px 10px', borderRadius: 8, fontSize: '.83rem', border: `1.5px solid ${bad ? '#fca5a5' : '#e5e7eb'}`, background: '#fff', fontFamily: 'inherit', minWidth: 0 });
const row         = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 };
const removeBtn   = { border: 'none', background: 'none', color: '#6b7280', cursor: 'pointer', fontSize: '.76rem', fontWeight: 600, padding: '4px 6px', lineHeight: 1, fontFamily: 'inherit' };
const addBtn      = { border: '1.5px dashed #c7d2fe', background: '#fff', color: '#635BFF', borderRadius: 8, padding: '6px 12px', fontSize: '.8rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' };
const isEmailLike = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
const linkBtn     = { border: 'none', background: 'none', color: '#635BFF', cursor: 'pointer', fontSize: '.76rem', padding: 0, fontFamily: 'inherit' };
const smallLabel  = { fontSize: '.72rem', color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 };
const playersLabel = { fontSize: '.8rem', fontWeight: 700, color: '#374151', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' };

/* An email box that takes an address the way people actually enter it: no
   auto-capitalising or autocorrect on phones, spaces dropped, and a pasted
   "Name <name@rku.ac.in>" or "mailto:name@rku.ac.in" reduced to the address.
   It's lower-cased when they leave the box; a mistake is pointed out then too. */
const cleanEmail = (v) => {
  const s = String(v || '');
  const m = s.match(/[^\s<>()"',;:]+@[^\s<>()"',;:]+\.[^\s<>()"',;:]+/);
  return (m ? m[0] : s.replace(/^mailto:/i, '')).replace(/\s+/g, '').replace(/[.,;]+$/, '').toLowerCase();
};
function EmailField({ value, onChange, placeholder = 'Their email', style, required = true }) {
  const [touched, setTouched] = useState(false);
  const v = value || '';
  const bad = v.trim() ? !isEmailLike(v) : required;
  const showErr = touched && v.trim() && !isEmailLike(v);
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, ...style }}>
      <input
        type="text" inputMode="email" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        style={{ ...input(bad && (touched || !v.trim())), width: '100%', boxSizing: 'border-box' }}
        maxLength={255} placeholder={placeholder} value={v} aria-invalid={showErr || undefined}
        onChange={e => onChange(e.target.value.replace(/\s+/g, ''))}
        onPaste={e => {
          const text = e.clipboardData?.getData('text') || '';
          if (/[<>\s]|mailto:/i.test(text)) { e.preventDefault(); onChange(cleanEmail(text)); }
        }}
        onBlur={() => { setTouched(true); if (v && v !== cleanEmail(v)) onChange(cleanEmail(v)); }}
      />
      {showErr && <span style={{ fontSize: '.7rem', color: '#dc2626' }}>Enter a full email, e.g. name@rku.ac.in</span>}
    </span>
  );
}

const catHead = { fontSize: '.8rem', fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '.04em', margin: '12px 0 6px' };

/* The Galore form (main coordinator, Manage event → Galore form): categories,
   their activities, the club responsible for each, individual / duo / team
   and the number of players, and guidelines. Coordinators are assigned on the
   Coordinators page (GaloreCoordinatorsBuilder below). uploadGuidelines: how
   guidelines files get uploaded (admin API by default). */
export default function GaloreFormBuilder({ value, onChange, clubs = [], uploadGuidelines }) {
  const { categories } = value;
  const set = (patch) => onChange({ ...value, ...patch });

  const setCat  = (key, patch) => set({ categories: categories.map(c => c.key === key ? { ...c, ...patch } : c) });
  const setAct  = (catKey, actKey, patch) => set({
    categories: categories.map(c => c.key !== catKey ? c : {
      ...c, activities: c.activities.map(a => a.key === actKey ? { ...a, ...patch } : a),
    }),
  });
  const move = (list, i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return list;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    return copy;
  };

  const up = uploadGuidelines || adminUpload;
  return (
    <div style={sectionBox}>
      <div style={sectionHead}>Categories &amp; Activities <span style={{ color: '#dc2626' }}>*</span></div>
      <p style={sectionHint}>
        Each category is a section of the registration form. For every activity pick <strong>Individual</strong>,
        <strong> Duo</strong> (2 players) or <strong>Team</strong> with its minimum and maximum players, the <strong>club</strong> responsible
        for it (it then also appears on that club's Events page) and its <strong>guidelines</strong> (PDF, Word or image).
        Coordinators are assigned on the Coordinators page; days, times and venues on the Schedule page.
      </p>
      <div style={{ ...row, background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <span style={{ fontSize: '.8rem', fontWeight: 700, color: '#374151', flex: '1 1 200px' }}>
          General guidelines <span style={{ fontWeight: 400, color: '#9ca3af' }}>(whole event)</span>
        </span>
        <RulesUpload url={value.rulesUrl} name={value.rulesName} label="Upload general guidelines" upload={up} onChange={patch => set(patch)} />
      </div>
      {clubs.length === 0 && (
        <div style={{ fontSize: '.78rem', color: '#b45309', marginBottom: 10 }}>
          No active clubs found for this campus — add them under All Clubs to assign one.
        </div>
      )}

      {categories.map((c, ci) => {
        const catLocked = c.activities.some(a => a.registrationCount > 0);
        return (
          <div key={c.key} style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '12px 12px 10px', marginBottom: 12 }}>
            <div style={{ ...row, marginBottom: 10 }}>
              <input style={{ ...input(!c.name.trim()), flex: '1 1 160px', fontWeight: 700, color: '#dc2626' }}
                value={c.name} maxLength={60} placeholder="Category, e.g. Sports-Outdoor"
                onChange={e => setCat(c.key, { name: e.target.value })} />
              <label style={smallLabel} title="How many activities from this category one student may register for (0 = no limit)">
                Max picks
                <input type="number" min={0} max={50} style={{ ...input(false), width: 60 }} value={c.maxPicks}
                  onChange={e => setCat(c.key, { maxPicks: e.target.value })} />
              </label>
              <button type="button" style={removeBtn} title="Move up" disabled={ci === 0}
                onClick={() => set({ categories: move(categories, ci, -1) })}>Up</button>
              <button type="button" style={removeBtn} title="Move down" disabled={ci === categories.length - 1}
                onClick={() => set({ categories: move(categories, ci, 1) })}>Down</button>
              <button type="button" style={{ ...removeBtn, opacity: catLocked ? 0.35 : 1, cursor: catLocked ? 'not-allowed' : 'pointer' }}
                title={catLocked ? 'Students have registered for activities in this category' : 'Remove category'}
                disabled={catLocked}
                onClick={() => set({ categories: categories.filter(x => x.key !== c.key) })}>Remove</button>
            </div>

            {c.activities.map(a => {
              const locked = a.registrationCount > 0;
              const unit = a.participationType;
              const minBad = !(Number(a.minTeamSize) >= 1);
              const maxBad = !(Number(a.teamSize) >= Number(a.minTeamSize) && Number(a.teamSize) >= 1);
              return (
                <div key={a.key} style={{ ...row, paddingBottom: 8, borderBottom: '1px solid #f3f4f6' }}>
                  <input style={{ ...input(!a.title.trim()), flex: '1 1 150px', color: '#111827' }} value={a.title} maxLength={120}
                    placeholder="Activity, e.g. Football" onChange={e => setAct(c.key, a.key, { title: e.target.value })} />
                  <select style={{ ...input(false), flex: '0 0 auto' }} value={unit} aria-label="Who takes part"
                    onChange={e => {
                      const t = e.target.value;
                      /* a duo is always 2 players; a team starts empty (its coordinator decides) */
                      setAct(c.key, a.key, t === 'duo' ? { participationType: t, minTeamSize: 2, teamSize: 2 }
                        : t === 'team' && unit !== 'team' ? { participationType: t, minTeamSize: '', teamSize: '' }
                        : { participationType: t });
                    }}>
                    <option value="individual">Individual</option>
                    <option value="duo">Duo</option>
                    <option value="team">Team</option>
                  </select>
                  {unit !== 'individual' && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <label style={playersLabel}>
                        Min players <span style={{ color: '#dc2626' }}>*</span>
                        <input type="number" min={1} max={100} inputMode="numeric" required disabled={unit === 'duo'}
                          style={{ ...input(unit === 'team' && minBad), width: 64 }}
                          value={unit === 'duo' ? 2 : a.minTeamSize} onChange={e => setAct(c.key, a.key, { minTeamSize: e.target.value })} />
                      </label>
                      <label style={playersLabel}>
                        Max players <span style={{ color: '#dc2626' }}>*</span>
                        <input type="number" min={1} max={100} inputMode="numeric" required disabled={unit === 'duo'}
                          style={{ ...input(unit === 'team' && maxBad), width: 64 }}
                          value={unit === 'duo' ? 2 : a.teamSize} onChange={e => setAct(c.key, a.key, { teamSize: e.target.value })} />
                      </label>
                    </span>
                  )}
                  {locked && <span style={{ fontSize: '.7rem', color: '#6b7280' }}>{a.registrationCount} registered</span>}
                  <button type="button" style={{ ...removeBtn, opacity: locked ? 0.35 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}
                    title={locked ? 'Students have already registered for this activity' : 'Remove activity'}
                    disabled={locked}
                    onClick={() => setCat(c.key, { activities: c.activities.filter(x => x.key !== a.key) })}>Remove</button>
                  {/* the club running it and its guidelines, on one line */}
                  <div style={{ ...row, flexBasis: '100%', margin: 0 }}>
                    <select style={{ ...input(false), flex: '1 1 200px', maxWidth: 320 }} value={a.clubId} title="The club responsible for this activity"
                      onChange={e => setAct(c.key, a.key, { clubId: e.target.value })}>
                      <option value="">Club responsible…</option>
                      {clubs.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                    </select>
                    <span style={{ fontSize: '.76rem', fontWeight: 700, color: '#374151' }}>Guidelines:</span>
                    <RulesUpload url={a.rulesUrl} name={a.rulesName} label="Upload guidelines" upload={up} onChange={patch => setAct(c.key, a.key, patch)} />
                  </div>
                </div>
              );
            })}
            <button type="button" style={addBtn}
              onClick={() => setCat(c.key, { activities: [...c.activities, blankActivity()] })}>
              + Add activity
            </button>
          </div>
        );
      })}
      <button type="button" style={addBtn} onClick={() => set({ categories: [...categories, blankCategory()] })}>
        + Add category
      </button>
    </div>
  );
}

/* The main coordinator's Coordinators page: every department (added or
   removed here) with its department coordinator, and each activity's
   coordinator under its category. Anyone can be assigned later — the event
   can already be published and open for registration. Each person typed in
   gets a Galore portal login by email. */
export function GaloreCoordinatorsBuilder({ value, onChange }) {
  const { departments, categories } = value;
  const set = (patch) => onChange({ ...value, ...patch });
  const setDept = (key, patch) => set({ departments: departments.map(d => d.key === key ? { ...d, ...patch } : d) });
  const setAct  = (catKey, actKey, patch) => set({
    categories: categories.map(c => c.key !== catKey ? c : {
      ...c, activities: c.activities.map(a => a.key === actKey ? { ...a, ...patch } : a),
    }),
  });
  const half = (n, e) => !String(n || '').trim() !== !String(e || '').trim();
  return (
    <>
      <div style={sectionBox}>
        <div style={sectionHead}>Departments &amp; Department Coordinators</div>
        <p style={sectionHint}>
          Use the department code from the student list (the School column, e.g. SOE). Each department coordinator sees every student from
          their department, in every activity, and is emailed their Galore portal login.
        </p>
        {departments.map(d => (
          <div key={d.key} style={row}>
            <input style={{ ...input(!d.name.trim()), flex: '1 1 120px' }} value={d.name} maxLength={100}
              placeholder="Department, e.g. SOE" onChange={e => setDept(d.key, { name: e.target.value })} />
            <input style={{ ...input(half(d.coordName, d.coordEmail) && !d.coordName.trim()), flex: '1.5 1 160px' }} value={d.coordName} maxLength={255}
              placeholder="Department coordinator's name" onChange={e => setDept(d.key, { coordName: e.target.value })} />
            <EmailField style={{ flex: '2 1 220px' }} value={d.coordEmail} required={!!d.coordName.trim()}
              placeholder="Department coordinator's email" onChange={coordEmail => setDept(d.key, { coordEmail })} />
            <button type="button" style={removeBtn} title="Remove department"
              onClick={() => set({ departments: departments.filter(x => x.key !== d.key) })}>Remove</button>
          </div>
        ))}
        <button type="button" style={addBtn} onClick={() => set({ departments: [...departments, blankDepartment()] })}>
          + Add department
        </button>
      </div>

      <div style={sectionBox}>
        <div style={sectionHead}>Activity Coordinators</div>
        <p style={sectionHint}>
          Each activity coordinator sees that activity's registrations, teams and fixtures from every department, and is emailed their
          Galore portal login. Activities are added in Manage event → Galore form.
        </p>
        {categories.map(c => (
          <div key={c.key}>
            <div style={catHead}>{c.name}</div>
            {c.activities.map(a => (
              <div key={a.key} style={row}>
                <span style={{ flex: '1 1 150px', fontSize: '.84rem', fontWeight: 700, color: '#111827' }}>{a.title}</span>
                <input style={{ ...input(half(a.coordinatorName, a.coordinatorEmail) && !a.coordinatorName.trim()), flex: '1.5 1 160px' }}
                  value={a.coordinatorName} maxLength={255} placeholder="Activity coordinator's name"
                  onChange={e => setAct(c.key, a.key, { coordinatorName: e.target.value })} />
                <EmailField style={{ flex: '2 1 220px' }} value={a.coordinatorEmail} required={!!a.coordinatorName.trim()}
                  placeholder="Activity coordinator's email" onChange={coordinatorEmail => setAct(c.key, a.key, { coordinatorEmail })} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
