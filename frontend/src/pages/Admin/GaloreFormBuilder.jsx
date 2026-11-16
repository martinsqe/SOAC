/* Galore form builder — the admin builds a Galore event's registration form the
   way you'd build a Google Form: departments (each with its department
   coordinator), categories (each with how many activities a student may pick
   from it) and the activities inside each category (each with the club that
   runs it and its activity coordinator). People are typed in by name + email —
   each gets a Galore portal login. Students then register through exactly
   this form. Shared by the admin (create / edit) and the overall Galore
   coordinator. */

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

/* `directory` = the university student directory's departments ({ code, students });
   a Galore department is matched to it by name = code, since students can only
   register for a department whose student list has been uploaded. */
/* showHead: the admin names the overall Galore coordinator here; hidden when
   that coordinator edits the form from the Galore portal. uploadGuidelines:
   how guidelines files get uploaded (admin API by default). */
export default function GaloreFormBuilder({ value, onChange, clubs = [], directory = null, onUploadDept, showHead = true, uploadGuidelines }) {
  const { departments, categories } = value;
  const [openDetails, setOpenDetails] = useState(() => new Set()); // activity keys with "Schedule & guidelines" expanded
  const toggleDetails = (key) => setOpenDetails(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const set = (patch) => onChange({ ...value, ...patch });

  const setDept = (key, patch) => set({ departments: departments.map(d => d.key === key ? { ...d, ...patch } : d) });
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
    <>
      {/* ── Overall Galore coordinator ── */}
      {showHead && (
        <div style={sectionBox}>
          <div style={sectionHead}>Overall Galore Coordinator <span style={{ color: '#dc2626' }}>*</span></div>
          <p style={sectionHint}>
            Runs the whole event from the Galore portal: sees every registration in every activity and department, sets the schedule,
            and can update the departments, activities and coordinators (but can't create or delete the event). They're emailed their login.
          </p>
          <div style={row}>
            <input style={{ ...input(!value.head?.name?.trim()), flex: '1 1 180px' }} maxLength={255} placeholder="Full name"
              value={value.head?.name || ''} onChange={e => set({ head: { ...value.head, name: e.target.value } })} />
            <EmailField style={{ flex: '2 1 220px' }} placeholder="Email, e.g. name@rku.ac.in"
              value={value.head?.email || ''} onChange={email => set({ head: { ...value.head, email } })} />
          </div>
        </div>
      )}

      {/* ── Departments ── */}
      <div style={sectionBox}>
        <div style={sectionHead}>Departments &amp; Department Coordinators <span style={{ color: '#dc2626' }}>*</span></div>
        <p style={sectionHint}>
          Use the department code from the student list (the School column, e.g. SOE). Students are placed in their department automatically
          from their university record. Each department coordinator sees every student from their department, in every activity, and is
          emailed their Galore portal login.
        </p>
        {departments.map(d => (
          <div key={d.key} style={row}>
            <input style={{ ...input(!d.name.trim()), flex: '1 1 140px' }} value={d.name} maxLength={100}
              placeholder="Department, e.g. SOE" onChange={e => setDept(d.key, { name: e.target.value })} />
            <input style={{ ...input(!d.coordName.trim()), flex: '1.5 1 160px' }} value={d.coordName} maxLength={255}
              placeholder="Department coordinator's name" onChange={e => setDept(d.key, { coordName: e.target.value })} />
            <EmailField style={{ flex: '2 1 220px' }} value={d.coordEmail}
              placeholder="Department coordinator's email" onChange={coordEmail => setDept(d.key, { coordEmail })} />
            {directory && d.name.trim() && (() => {
              const hit = directory.find(x => x.code.toUpperCase() === d.name.trim().toUpperCase());
              return hit && hit.students > 0 ? (
                <span style={{ fontSize: '.72rem', color: '#047857', fontWeight: 600, whiteSpace: 'nowrap' }}
                  title="Student list uploaded — click to upload a newer file">
                  {hit.students.toLocaleString('en-IN')} students listed{' '}
                  <button type="button" style={{ ...removeBtn, fontSize: '.72rem', color: '#635BFF', padding: 0 }}
                    onClick={() => onUploadDept?.(d.name.trim())}>update</button>
                </span>
              ) : (
                <button type="button" style={{ ...addBtn, borderStyle: 'solid', borderColor: '#fcd34d', color: '#b45309', padding: '5px 10px' }}
                  title="No students from this department can register until their list is uploaded"
                  onClick={() => onUploadDept?.(d.name.trim())}>
                  Upload student list
                </button>
              );
            })()}
            <button type="button" style={removeBtn} title="Remove department"
              onClick={() => set({ departments: departments.filter(x => x.key !== d.key) })}>Remove</button>
          </div>
        ))}
        <button type="button" style={addBtn} onClick={() => set({ departments: [...departments, blankDepartment()] })}>
          + Add department
        </button>
      </div>

      {/* ── Categories & activities ── */}
      <div style={sectionBox}>
        <div style={sectionHead}>Categories &amp; Activities <span style={{ color: '#dc2626' }}>*</span></div>
        <p style={sectionHint}>
          Each category is a section of the registration form. Every activity needs the <strong>club</strong> that runs it — it appears as a
          published event on that club's Events page, where its Faculty Advisor and Student Coordinator manage teams, fixtures and results —
          and an <strong>activity coordinator</strong> (name + email), who sees that activity's registrations, teams and fixtures from every department.
          Pick <strong>Individual</strong>, <strong>Duo</strong> (2 players) or <strong>Team</strong> (with its minimum and maximum players), and upload the
          activity's <strong>guidelines</strong> (PDF, Word or image) right under it. Open <strong>Date, time &amp; venue</strong> to schedule it. These can be added later —
          until then students and staff see "To be announced" (the event's own date and venue are the whole festival's).
        </p>
        <div style={{ ...row, background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
          <span style={{ fontSize: '.8rem', fontWeight: 700, color: '#374151', flex: '1 1 200px' }}>
            General guidelines <span style={{ fontWeight: 400, color: '#9ca3af' }}>(whole event, optional)</span>
          </span>
          <RulesUpload url={value.rulesUrl} name={value.rulesName} label="Upload general guidelines" upload={up} onChange={patch => set(patch)} />
        </div>
        {clubs.length === 0 && (
          <div style={{ fontSize: '.78rem', color: '#b45309', marginBottom: 10 }}>
            No active clubs found for this campus. Add clubs first, under All Clubs.
          </div>
        )}

        {categories.map((c, ci) => {
          const catLocked = c.activities.some(a => a.registrationCount > 0);
          return (
            <div key={c.key} style={{ background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '12px 12px 10px', marginBottom: 12 }}>
              <div style={{ ...row, marginBottom: 10 }}>
                <input style={{ ...input(!c.name.trim()), flex: '1 1 160px', fontWeight: 700, color: '#635BFF' }}
                  value={c.name} maxLength={60} placeholder="Category, e.g. Sports"
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
                const isTeam = a.participationType === 'team';
                const minBad = !(Number(a.minTeamSize) >= 1);
                const maxBad = !(Number(a.teamSize) >= Number(a.minTeamSize) && Number(a.teamSize) >= 1);
                return (
                  <div key={a.key} style={{ ...row, paddingLeft: 10, borderLeft: '3px solid #eef2ff' }}>
                    <input style={{ ...input(!a.title.trim()), flex: '1 1 130px' }} value={a.title} maxLength={120}
                      placeholder="Activity, e.g. Football" onChange={e => setAct(c.key, a.key, { title: e.target.value })} />
                    <select style={{ ...input(false), flex: '0 0 auto' }} value={a.participationType} aria-label="Who takes part"
                      onChange={e => {
                        const t = e.target.value;
                        /* switching to Team from a duo starts from 2 – 2, the rest stays as typed */
                        setAct(c.key, a.key, t === 'team' && a.participationType === 'duo'
                          ? { participationType: t, minTeamSize: 2, teamSize: 2 } : { participationType: t });
                      }}>
                      <option value="individual">Individual</option>
                      <option value="duo">Duo (2 players)</option>
                      <option value="team">Team</option>
                    </select>
                    {isTeam && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <label style={playersLabel}>
                          Min players
                          <input type="number" min={1} max={100} inputMode="numeric" style={{ ...input(minBad), width: 64 }}
                            value={a.minTeamSize} onChange={e => setAct(c.key, a.key, { minTeamSize: e.target.value })} />
                        </label>
                        <label style={playersLabel}>
                          Max players
                          <input type="number" min={1} max={100} inputMode="numeric" style={{ ...input(maxBad), width: 64 }}
                            value={a.teamSize} onChange={e => setAct(c.key, a.key, { teamSize: e.target.value })} />
                        </label>
                      </span>
                    )}
                    <button type="button" style={{ ...linkBtn, whiteSpace: 'nowrap' }} onClick={() => toggleDetails(a.key)}
                      title="This activity's own date, time and venue">
                      {openDetails.has(a.key) ? 'Hide date, time & venue' : 'Date, time & venue'}
                      {!openDetails.has(a.key) && a.scheduleDate ? ' (date set)' : ''}
                    </button>
                    {locked && <span style={{ fontSize: '.7rem', color: '#6b7280' }}>{a.registrationCount} registered</span>}
                    <button type="button" style={{ ...removeBtn, opacity: locked ? 0.35 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}
                      title={locked ? 'Students have already registered for this activity' : 'Remove activity'}
                      disabled={locked}
                      onClick={() => setCat(c.key, { activities: c.activities.filter(x => x.key !== a.key) })}>Remove</button>
                    {/* who runs it */}
                    <div style={{ ...row, flexBasis: '100%', margin: '0 0 2px' }}>
                      <select style={{ ...input(!a.clubId), flex: '1.5 1 170px' }} value={a.clubId} title="The club responsible for this activity"
                        onChange={e => setAct(c.key, a.key, { clubId: e.target.value })}>
                        <option value="">Club responsible…</option>
                        {clubs.map(cl => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
                      </select>
                      <input style={{ ...input(!a.coordinatorName.trim()), flex: '1.5 1 160px' }} value={a.coordinatorName} maxLength={255}
                        placeholder="Activity coordinator's name" onChange={e => setAct(c.key, a.key, { coordinatorName: e.target.value })} />
                      <EmailField style={{ flex: '2 1 240px' }} value={a.coordinatorEmail}
                        placeholder="Activity coordinator's email, e.g. name@rku.ac.in" onChange={coordinatorEmail => setAct(c.key, a.key, { coordinatorEmail })} />
                    </div>
                    {/* guidelines — always in view, so they're added with the activity */}
                    <div style={{ ...row, flexBasis: '100%', margin: '0 0 4px' }}>
                      <span style={{ fontSize: '.76rem', fontWeight: 700, color: '#374151' }}>Guidelines:</span>
                      <RulesUpload url={a.rulesUrl} name={a.rulesName} label="Upload guidelines" upload={up} onChange={patch => setAct(c.key, a.key, patch)} />
                    </div>
                    {openDetails.has(a.key) && (
                      <div style={{ ...row, flexBasis: '100%', margin: '2px 0 4px', padding: '8px 10px', background: '#f9fafb', borderRadius: 8 }}>
                        <label style={smallLabel}>Date
                          <input type="date" style={input(false)} value={a.scheduleDate} onChange={e => setAct(c.key, a.key, { scheduleDate: e.target.value })} />
                        </label>
                        <label style={smallLabel}>Time
                          <input style={{ ...input(false), width: 130 }} maxLength={100} placeholder="e.g. 10:00 AM" value={a.time}
                            onChange={e => setAct(c.key, a.key, { time: e.target.value })} />
                        </label>
                        <label style={{ ...smallLabel, flex: '1 1 160px' }}>Venue
                          <input style={{ ...input(false), flex: 1 }} maxLength={255} placeholder="e.g. Main Ground" value={a.venue}
                            onChange={e => setAct(c.key, a.key, { venue: e.target.value })} />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
              <button type="button" style={{ ...addBtn, marginLeft: 10 }}
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
    </>
  );
}
