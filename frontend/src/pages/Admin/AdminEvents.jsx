import { useState, useEffect, useRef, useCallback } from 'react'; // useCallback used below
import api from '../../api/client';
import { fetchAllPages } from '../../utils/pagination';
import CertTemplateEditor from '../../components/CertTemplateEditor/CertTemplateEditor';
import s from './AdminEvents.module.css';

/* Long description cut to `limit` characters with an inline "…read more"
   that expands the full text in place (and "show less" to collapse it). */
function ReadMore({ text, limit = 150, as = 'p', className, style }) {
  const [open, setOpen] = useState(false);
  const Tag = as;
  if (!text) return null;
  const full = String(text).trim();
  const long = full.length > limit;
  let preview = full.slice(0, limit);
  const cut = preview.lastIndexOf(' ');
  if (cut > limit * 0.6) preview = preview.slice(0, cut);
  preview = preview.replace(/[\s.,;:!?-]+$/, '');
  return (
    <Tag className={className} style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere', ...style }}>
      {open || !long ? full : preview + '…'}
      {long && (
        <>
          {' '}
          <button type="button" aria-expanded={open}
            onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
            style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: '#635BFF', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {open ? 'show less' : 'read more'}
          </button>
        </>
      )}
    </Tag>
  );
}


const CATS   = ['tech','sports','cultural','annual-fest','health','leadership','community','general'];
const STATUS = ['upcoming','past'];

/* Sports Fiesta teammates (unlike the captain) never supply a real email on
   the roster form, so each gets a synthetic @roster.internal placeholder just
   to satisfy the registrations table's unique-email constraint — never meant
   to be shown to anyone. Blank it out wherever registrations are displayed. */
const isPlaceholderEmail = (email) => /@roster\.internal$/i.test(email || '');
const displayEmail = (email) => isPlaceholderEmail(email) ? '—' : (email || '—');

/* ── Extra registration questions (Other Events) ──
   Admin defines them on the event; each registrant's answers come back as
   extra_answers [{ id, label, value }]. Columns = the event's current
   questions plus any older ones still present in answers (label kept). */
const QUESTION_TYPES = [
  { value: 'text',     label: 'Short answer' },
  { value: 'textarea', label: 'Paragraph' },
  { value: 'number',   label: 'Number' },
  { value: 'select',   label: 'Dropdown' },
  { value: 'yesno',    label: 'Yes / No' },
  { value: 'date',     label: 'Date' },
];
const STANDARD_REG_FIELDS = ['Name', 'Email', 'Enrollment No.', 'Department', 'Course', 'Mobile', 'Gender'];
const MAX_QUESTIONS = 15;
const QUESTION_PRESETS = [
  { label: 'Year of study', type: 'select', options: ['1st Year', '2nd Year', '3rd Year', '4th Year', '5th Year'] },
  { label: 'T-shirt size',  type: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { label: 'Team name',     type: 'text' },
  { label: 'Will you bring your own laptop?', type: 'yesno' },
  { label: 'Dietary preference', type: 'select', options: ['Vegetarian', 'Non-vegetarian', 'Jain', 'Vegan'] },
  { label: 'Why do you want to participate?', type: 'textarea' },
];
const newQuestionId = () => `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const answerColumns = (event, regs) => {
  const cols = (event?.customFields || []).map(f => ({ id: f.id, label: f.label }));
  const ids = new Set(cols.map(c => c.id));
  regs.forEach(r => (r.extra_answers || []).forEach(a => {
    if (!ids.has(a.id)) { ids.add(a.id); cols.push({ id: a.id, label: a.label }); }
  }));
  return cols;
};
const answerOf = (r, id) => (r.extra_answers || []).find(a => a.id === id)?.value || '';
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/* Admin's editor for an event's extra registration questions */
function QuestionBuilder({ questions, onChange }) {
  const [lastAdded, setLastAdded] = useState(null); // focus the label of a just-added question
  const update = (i, patch) => onChange(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const remove = (i) => onChange(questions.filter((_, j) => j !== i));
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const add = (preset) => {
    const id = newQuestionId();
    setLastAdded(preset ? null : id);
    onChange([...questions, {
      id, label: '', type: 'text', required: false, ...(preset || {}),
      optionsText: preset?.options ? preset.options.join('\n') : '',
    }]);
  };
  const used = new Set(questions.map(q => q.label.trim().toLowerCase()));
  const full = questions.length >= MAX_QUESTIONS;
  const optionsOf = (q) => (q.optionsText ?? (q.options || []).join('\n')).split('\n').map(o => o.trim()).filter(Boolean);

  const iconBtn = (disabled) => ({
    border: '1px solid #e5e7eb', background: '#fff', borderRadius: 8, width: 30, height: 30,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .35 : 1, fontSize: '.85rem', color: '#374151',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  });
  const inputSt = {
    width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: 8,
    border: '1.5px solid #e5e7eb', fontSize: '.85rem', fontFamily: 'inherit', background: '#fff',
  };

  return (
    <div style={{ background: '#fafaff', border: '1.5px solid #e6e3fb', borderRadius: 12, padding: '16px 16px 14px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontSize: '.78rem', fontWeight: 800, color: '#1f1a4d', textTransform: 'uppercase', letterSpacing: '.04em' }}>
          Additional Registration Questions
        </div>
        <span style={{ fontSize: '.72rem', fontWeight: 700, padding: '2px 9px', borderRadius: 20,
          background: questions.length ? '#ede9fe' : '#f3f4f6', color: questions.length ? '#5b21b6' : '#9ca3af' }}>
          {questions.length} / {MAX_QUESTIONS}
        </span>
      </div>

      {/* What's already collected */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, margin: '8px 0 14px' }}>
        <span style={{ fontSize: '.74rem', color: '#6b7280', marginRight: 2 }}>Already asked:</span>
        {STANDARD_REG_FIELDS.map(f => (
          <span key={f} style={{ fontSize: '.7rem', padding: '2px 8px', borderRadius: 6, background: '#f3f4f6', color: '#6b7280' }}>{f}</span>
        ))}
      </div>

      {/* Questions */}
      {questions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '18px 12px', border: '1.5px dashed #d9d5f5', borderRadius: 10, background: '#fff' }}>
          <div style={{ fontSize: '.85rem', fontWeight: 700, color: '#1f1a4d' }}>No extra questions yet</div>
          <div style={{ fontSize: '.77rem', color: '#6b7280', marginTop: 2 }}>
            Add one below if this event needs more from students, like a T-shirt size or team name.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {questions.map((q, i) => {
            const opts = q.type === 'select' ? optionsOf(q) : [];
            return (
              <div key={q.id} style={{ background: '#fff', border: '1.5px solid #e5e7eb',
                borderRadius: 10, padding: '12px 14px', boxShadow: '0 1px 3px rgba(15,10,46,.04)' }}>

                {/* Row 1: number · question · type */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ width: 24, height: 24, borderRadius: '50%', background: '#ede9fe', color: '#5b21b6',
                    fontSize: '.72rem', fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <input value={q.label} onChange={e => update(i, { label: e.target.value })}
                    placeholder="Type your question, e.g. T-shirt size" maxLength={150}
                    autoFocus={q.id === lastAdded}
                    style={{ ...inputSt, flex: '1 1 220px', width: 'auto', minWidth: 0, fontWeight: 600,
                      borderColor: q.label.trim() ? '#e5e7eb' : '#fcd34d' }} />
                  <select value={q.type} onChange={e => update(i, { type: e.target.value })}
                    style={{ ...inputSt, flex: '0 0 150px', width: 'auto' }}>
                    {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>

                {/* Row 2: type-specific settings */}
                {q.type === 'select' && (
                  <div style={{ marginTop: 8, marginLeft: 32 }}>
                    <textarea rows={3} value={q.optionsText ?? (q.options || []).join('\n')}
                      onChange={e => update(i, { optionsText: e.target.value })}
                      placeholder={'One choice per line\nOption A\nOption B'}
                      style={{ ...inputSt, resize: 'vertical' }} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {opts.length === 0
                        ? <span style={{ fontSize: '.72rem', color: '#b45309' }}>Add at least one choice.</span>
                        : opts.map(o => (
                            <span key={o} style={{ fontSize: '.7rem', padding: '2px 8px', borderRadius: 20,
                              background: '#f5f3ff', color: '#5b21b6', border: '1px solid #e6e3fb' }}>{o}</span>
                          ))}
                    </div>
                  </div>
                )}
                {['text', 'textarea', 'number'].includes(q.type) && (
                  <div style={{ marginTop: 8, marginLeft: 32 }}>
                    <input value={q.placeholder || ''} onChange={e => update(i, { placeholder: e.target.value })}
                      placeholder="Example answer shown to students (optional)" maxLength={150}
                      style={{ ...inputSt, fontSize: '.8rem', color: '#4b5563' }} />
                  </div>
                )}

                {/* Row 3: required toggle · reorder · delete */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: 32 }}>
                  <button type="button" onClick={() => update(i, { required: !q.required })} aria-pressed={!!q.required}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 5px', borderRadius: 20,
                      border: `1.5px solid ${q.required ? '#635BFF' : '#e5e7eb'}`, background: q.required ? '#f5f3ff' : '#fff',
                      color: q.required ? '#5b21b6' : '#6b7280', fontSize: '.75rem', fontWeight: 700, cursor: 'pointer', marginRight: 'auto' }}>
                    <span style={{ width: 26, height: 15, borderRadius: 10, background: q.required ? '#635BFF' : '#d1d5db',
                      position: 'relative', transition: 'background .15s', flexShrink: 0 }}>
                      <span style={{ position: 'absolute', top: 2, left: q.required ? 13 : 2, width: 11, height: 11,
                        borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
                    </span>
                    {q.required ? 'Required' : 'Optional'}
                  </button>
                  <button type="button" title="Move up"   aria-label="Move up"   onClick={() => move(i, -1)} disabled={i === 0} style={iconBtn(i === 0)}>↑</button>
                  <button type="button" title="Move down" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === questions.length - 1} style={iconBtn(i === questions.length - 1)}>↓</button>
                  <button type="button" title="Remove question" aria-label="Remove question" onClick={() => remove(i)}
                    style={{ ...iconBtn(false), color: '#dc2626', borderColor: '#fecaca', background: '#fff5f5' }}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add */}
      <button type="button" onClick={() => add()} disabled={full}
        style={{ width: '100%', marginTop: 12, padding: '9px 14px', borderRadius: 10, border: '1.5px dashed #a5a0f5',
          background: full ? '#f9fafb' : '#f5f3ff', color: full ? '#9ca3af' : '#635BFF', fontWeight: 700, fontSize: '.83rem',
          cursor: full ? 'default' : 'pointer' }}>
        {full ? `Maximum of ${MAX_QUESTIONS} questions reached` : '+ Add a question'}
      </button>
      {!full && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 10 }}>
          <span style={{ fontSize: '.74rem', color: '#6b7280' }}>Quick add:</span>
          {QUESTION_PRESETS.filter(p => !used.has(p.label.toLowerCase())).slice(0, 4).map(p => (
            <button key={p.label} type="button" onClick={() => add(p)}
              style={{ padding: '4px 10px', borderRadius: 20, border: '1px solid #e5e7eb', background: '#fff',
                color: '#4b5563', fontSize: '.74rem', cursor: 'pointer' }}>
              + {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Form state → what the API stores (options from the one-per-line box) */
const serializeQuestions = (questions) => JSON.stringify(questions
  .filter(q => q.label.trim())
  .map(({ optionsText, ...q }) => ({
    ...q,
    label: q.label.trim(),
    ...(q.type === 'select'
      ? { options: (optionsText ?? (q.options || []).join('\n')).split('\n').map(o => o.trim()).filter(Boolean) }
      : { options: undefined }),
  })));
const questionsError = (questions) => {
  for (const [i, q] of questions.entries()) {
    if (!q.label.trim()) return `Question ${i + 1} needs a label (or remove it).`;
    if (q.type === 'select') {
      const opts = (q.optionsText ?? (q.options || []).join('\n')).split('\n').map(o => o.trim()).filter(Boolean);
      if (!opts.length) return `Add at least one option for "${q.label.trim()}".`;
    }
  }
  return '';
};

const CAT_COLOR = {
  tech: '#635BFF', sports: '#FF4757', cultural: '#FF6B9D',
  'annual-fest': '#D32F2F', health: '#00C896', leadership: '#9B2335',
  community: '#A259FF', general: '#888',
};
const CAT_LABEL = {
  tech: 'Tech', sports: 'Sports', cultural: 'Cultural',
  'annual-fest': 'Annual Fest', health: 'Health',
  leadership: 'Leadership', community: 'Community', general: 'General',
};

const EMPTY = {
  title: '', clubId: '', category: 'general', status: 'upcoming',
  date: '', startDate: '', time: '', venue: '',
  description: '', seats: '', highlight: '', registrationUrl: '',
  isFree: true, feeAmount: '',
  customFields: [], // extra registration questions — see QuestionBuilder
};

/* Sports Fiesta events collect the same core details as Other Events
   (club, category, schedule, venue, description, fee, tags…) plus a
   roster-size cap the admin decides and a payment link. The captain fills
   in their own contact details and team member names later via the public
   event page — the admin just sets how many teammates they're allowed to add. */
const EMPTY_SF = {
  title: '', clubId: '', category: 'sports', status: 'upcoming',
  date: '', startDate: '', time: '', venue: '',
  description: '', seats: '', highlight: '', registrationUrl: '',
  isFree: true, feeAmount: '',
  minTeamSize: '', teamSize: '', paymentLink: '',
};

/* ── Galore: one umbrella event (Galore 2027) holding every pre-programmed
   activity underneath it (parentEventId) — see events.controller.js's
   GALORE_ACTIVITIES_CATALOG. Never a paid event: no fee fields at all, here
   or on any activity. Admin's only real decision per activity is who
   coordinates it — the event can't be created until every single one has a
   coordinator assigned (enforced both here and server-side). ── */
const EMPTY_GALORE = {
  title: '', status: 'upcoming', date: '', startDate: '', time: '', venue: '',
  description: '', seats: '', highlight: '',
};
const GALORE_CATEGORY_LABEL = { sports: 'Sports', cultural: 'Cultural', academic: 'Academic' };

const REQ_STATUS_META = {
  pending_fc: { label: 'Pending Faculty Coordinator Review', color: '#7c3aed', bg: '#f5f3ff' },
  pending:    { label: 'Pending',                            color: '#d97706', bg: '#fffbeb' },
  approved:   { label: 'Approved',                           color: '#059669', bg: '#ecfdf5' },
  rejected:   { label: 'Rejected',                           color: '#dc2626', bg: '#fef2f2' },
};

/* The chain a request actually travelled — Student Coordinator → Faculty
   Coordinator → Admin, or straight from whoever submitted it → Admin when
   there's no Faculty Coordinator stage (an FC's own request, or a club with
   no FC assigned when it was submitted). */
const requestChain = (req) => {
  const steps = [req.submittedByRole === 'faculty_coordinator' ? 'Faculty Coordinator' : 'Student Coordinator'];
  /* Went (or is still going) through the Faculty Coordinator stage if it's
     currently sitting there, or already has an FC reviewer recorded. An SC
     request with neither means no FC was assigned to that club when it was
     submitted, so it skipped straight to Admin. */
  const wentThroughFC = req.submittedByRole === 'coordinator' && (req.status === 'pending_fc' || !!req.fcReviewedByName);
  if (wentThroughFC) steps.push('Faculty Coordinator');
  steps.push('Admin');
  return steps;
};

/* ── Event Card ── */
function EventCard({ ev, onEdit, onDelete, onViewRegs, onToggleReg }) {
  const color = CAT_COLOR[ev.category] || '#888';
  const imgSrc = ev.imageUrl || (ev.image ? `/images/${ev.image}` : null);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyLink = () => {
    const url = `${window.location.origin}/events/${ev._id}`;
    navigator.clipboard?.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <div className={s.card}>
      <div className={s.cardImg}>
        {imgSrc
          ? <img src={imgSrc} alt={ev.title} loading="lazy" onError={e => { e.target.style.display = 'none'; }} />
          : <div className={s.cardImgFallback}>Banner</div>
        }
      </div>
      <div className={s.cardBody}>
        <div className={s.cardTitle}>{ev.title}</div>
        <div className={s.cardClub}>Organizer: {ev.club || 'No organizer'}</div>
        <ReadMore as="div" text={ev.description} limit={100}
          style={{ fontSize: '.8rem', color: '#6b7280', lineHeight: 1.45, margin: '4px 0 6px' }} />
        <div className={s.cardMeta}>
          {ev.date && <span>Date: {ev.date}</span>}
          {ev.venue && <span>Venue: {ev.venue}</span>}
          {ev.time && <span>Time: {ev.time}</span>}
        </div>
        {ev.seats && <div className={s.cardSeats}>Seats: {ev.seats}</div>}
        {ev.tags?.length > 0 && (
          <div className={s.cardTags}>
            {ev.tags.slice(0, 3).map(t => <span key={t} className={s.tag}>{t}</span>)}
          </div>
        )}
      </div>
      <div className={s.cardActions}>
        <button className={s.regsBtn} onClick={() => onViewRegs(ev)}>Registrations</button>
        <button className={s.editBtn} onClick={() => onEdit(ev)}>Edit</button>
        <button className={s.delBtn} onClick={() => onDelete(ev._id)}>Delete</button>
      </div>
      <div className={s.cardActions} style={{ borderTop: 'none', paddingTop: 0 }}>
        <button
          className={s.regsBtn}
          onClick={() => onToggleReg(ev)}
          style={{ width: '100%' }}
          title={ev.registrationClosed ? 'Let students register again' : 'Stop new registrations without changing the event status'}
        >
          {ev.registrationClosed ? 'Reopen Registration' : 'Close Registration'}
        </button>
      </div>
      <div className={s.cardActions} style={{ borderTop: 'none', paddingTop: 0 }}>
        <button className={s.regsBtn} onClick={copyLink} style={{ width: '100%' }} title="Copy a direct link students can use to register">
          {linkCopied ? 'Link copied ✓' : '🔗 Copy Registration Link'}
        </button>
      </div>
    </div>
  );
}

/* ── Sports Fiesta Card — the admin sets up the event + roster cap; captains
   fill in their own contact details and their team's members later via the
   public event page (the shareable link below). Every one of them (captain
   included) lands in event_registrations just like an Other Events sign-up,
   so "Registrations" here opens the exact same panel/CSV export, just
   showing every team's members instead of individual sign-ups. ── */
function SportsFiestaCard({ ev, onEdit, onDelete, onViewRegs, onToggleReg }) {
  const imgSrc = ev.imageUrl || (ev.image ? `/images/${ev.image}` : null);
  const captainSet = !!ev.captainName;
  const [linkCopied, setLinkCopied] = useState(false);
  const copyLink = () => {
    const url = `${window.location.origin}/events/${ev._id}`;
    navigator.clipboard?.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <div className={s.card}>
      <div className={s.cardImg}>
        {imgSrc
          ? <img src={imgSrc} alt={ev.title} loading="lazy" onError={e => { e.target.style.display = 'none'; }} />
          : <div className={s.cardImgFallback}>Banner</div>
        }
      </div>
      <div className={s.cardBody}>
        <div className={s.cardTitle}>{ev.title}</div>
        <div className={s.cardClub}>Organizer: {ev.club || 'No organizer'}</div>
        <ReadMore as="div" text={ev.description} limit={100}
          style={{ fontSize: '.8rem', color: '#6b7280', lineHeight: 1.45, margin: '4px 0 6px' }} />
        <div className={s.cardMeta}>
          {ev.date && <span>Date: {ev.date}</span>}
          {ev.venue && <span>Venue: {ev.venue}</span>}
          {ev.time && <span>Time: {ev.time}</span>}
        </div>
        {/* The event can have several teams, each with its own captain — this
            card only mirrors the MOST RECENT submission (cheap, no extra
            join), so it's labelled "Latest", not "The". See the coordinator's
            Teams tab (or dashboard) for the full list of teams. */}
        <div className={s.cardMeta}>
          {captainSet
            ? <>
                <span>Latest team: {ev.captainName}</span>
                {ev.captainEmail && <span>Email: {ev.captainEmail}</span>}
                {ev.captainPhone && <span>Phone: {ev.captainPhone}</span>}
              </>
            : <span>No teams submitted yet</span>
          }
        </div>
        {ev.paymentLink && (
          <div className={s.cardMeta}>
            <a href={ev.paymentLink} target="_blank" rel="noreferrer">Payment link ↗</a>
          </div>
        )}
      </div>
      <div className={s.cardActions}>
        <button className={s.regsBtn} onClick={() => onViewRegs(ev)}>Registrations</button>
        <button className={s.editBtn} onClick={() => onEdit(ev)}>Edit</button>
        <button className={s.delBtn} onClick={() => onDelete(ev._id)}>Delete</button>
      </div>
      <div className={s.cardActions} style={{ borderTop: 'none', paddingTop: 0 }}>
        <button
          className={s.regsBtn}
          onClick={() => onToggleReg(ev)}
          style={{ width: '100%' }}
          title={ev.registrationClosed ? 'Let captains submit team rosters again' : 'Stop new team rosters without changing the event status'}
        >
          {ev.registrationClosed ? 'Reopen Registration' : 'Close Registration'}
        </button>
      </div>
      <div className={s.cardActions} style={{ borderTop: 'none', paddingTop: 0 }}>
        <button className={s.regsBtn} onClick={copyLink} style={{ width: '100%' }} title="Copy the link the captain uses to fill in their team roster">
          {linkCopied ? 'Link copied ✓' : '🔗 Copy Team Link'}
        </button>
      </div>
    </div>
  );
}

/* ══ Main AdminEvents ══ */
export default function AdminEvents() {
  /* ── page tab ── */
  const [pageTab,     setPageTab]     = useState('events');

  /* ── event-format tab (within "All Events"): other | sports_fiesta | galore ── */
  const [formatTab,   setFormatTab]   = useState('other');

  /* ── events state ── */
  const [events,      setEvents]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [statusF,     setStatusF]     = useState('all');
  const [modal,       setModal]       = useState(false);
  const [form,        setForm]        = useState(EMPTY);
  const [editing,     setEditing]     = useState(null);
  const [approvingId, setApprovingId] = useState(null); // request id being approved via modal
  const [imgFile,     setImgFile]     = useState(null);
  const [imgPrev,     setImgPrev]     = useState('');
  const [tagsStr,     setTagsStr]     = useState('');
  const [saving,      setSaving]      = useState(false);
  const [deleteId,    setDeleteId]    = useState(null);
  const [error,       setError]       = useState('');

  /* ── certificate templates (edit mode only — event must already have an id) ── */
  const [templates,       setTemplates]       = useState({ participation: null, runner_up: null, winner: null });
  const [templatesLoading, setTemplatesLoading] = useState(false);

  /* ── requests state ── */
  const [requests,    setRequests]    = useState([]);
  const [reqLoading,  setReqLoading]  = useState(false);
  const [reqFilter,   setReqFilter]   = useState('pending');
  const [rejectModal, setRejectModal] = useState(null); // { id, title }
  const [rejectNote,  setRejectNote]  = useState('');
  const [rejecting,   setRejecting]   = useState(false);
  const [toast,       setToast]       = useState('');

  /* ── Clubs list (for dropdown) ── */
  const [clubs, setClubs] = useState([]);

  /* ── Registrations panel ── */
  const [regEvent,    setRegEvent]    = useState(null);
  const [regs,        setRegs]        = useState([]);
  const [regsLoading, setRegsLoading] = useState(false);
  const [regSearch,   setRegSearch]   = useState('');
  const fileRef = useRef();

  /* ── Teams sub-tab (registered teams for the event open in the panel above) —
     same backend the coordinator's own Teams tab uses, so a team edited/deleted/
     updated here shows up identically on their side and vice versa. ── */
  const [regsTab,       setRegsTab]       = useState('list'); // 'list' | 'teams'
  const [teams,         setTeams]         = useState([]);
  const [teamsLoading,  setTeamsLoading]  = useState(false);
  const [expandedTeams, setExpandedTeams] = useState(new Set());
  const [newTeamName,   setNewTeamName]   = useState({ boys: '', girls: '', open: '' });
  const [newTeamSize,   setNewTeamSize]   = useState({ boys: '', girls: '', open: '' });
  const [creatingTeam,  setCreatingTeam]  = useState({ boys: false, girls: false, open: false });
  const [teamEdits,     setTeamEdits]     = useState({}); // { teamId: {name, maxSize} }

  /* ── Sports Fiesta add/edit modal (separate from the Other Events modal, but
     collects the same core event fields plus captain + roster-cap + payment link) ── */
  const [sfModal,   setSfModal]   = useState(false); // false | 'add' | 'edit'
  const [sfForm,    setSfForm]    = useState(EMPTY_SF);
  const [sfEditing, setSfEditing] = useState(null);
  const [sfImgFile, setSfImgFile] = useState(null);
  const [sfImgPrev, setSfImgPrev] = useState('');
  const [sfTagsStr, setSfTagsStr] = useState('');
  const [sfSaving,  setSfSaving]  = useState(false);
  const [sfError,   setSfError]   = useState('');
  const sfFileRef = useRef();

  /* ── Galore: umbrella create modal (catalog + one coordinator picker per
     activity, all created together) and the "activities" panel for a
     selected umbrella (registrations list + department-wise registrant view). ── */
  const [galoreModal,   setGaloreModal]   = useState(false); // false | true
  const [galoreEditing, setGaloreEditing] = useState(null); // null = creating, else the umbrella id being edited
  const [galoreForm,    setGaloreForm]    = useState(EMPTY_GALORE);
  const [galoreImgFile, setGaloreImgFile] = useState(null);
  const [galoreImgPrev, setGaloreImgPrev] = useState('');
  const [galoreSaving,  setGaloreSaving]  = useState(false);
  const [galoreError,   setGaloreError]   = useState('');
  const galoreFileRef = useRef();

  const [galoreCatalog,      setGaloreCatalog]      = useState([]);
  const [galoreCoordinators, setGaloreCoordinators] = useState([]);
  const [galoreAssignments,  setGaloreAssignments]  = useState({}); // { [activityKey]: coordinatorUserId }

  const [selectedGalore,    setSelectedGalore]    = useState(null); // umbrella event, when drilled into its activities
  const [activities,        setActivities]        = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);

  const [galoreSubTab, setGaloreSubTab] = useState('activities'); // 'activities' | 'departments'
  const [deptRegs,        setDeptRegs]        = useState([]);
  const [deptRegsLoading, setDeptRegsLoading] = useState(false);
  const [activeDeptTab,   setActiveDeptTab]   = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(() => {
    setLoading(true);
    api.get('/events')
      .then(d => setEvents(d.events || []))
      .catch(() => setError('Failed to load events.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api.get('/clubs?limit=200').then(d => setClubs(d.clubs || [])).catch(() => {});
  }, []);

  const loadRequests = useCallback(() => {
    setReqLoading(true);
    api.get('/event-requests')
      .then(d => setRequests(d.requests || []))
      .catch(() => {})
      .finally(() => setReqLoading(false));
  }, []);
  /* Loaded eagerly (not gated on pageTab === 'requests') so the pending-count
     badge on the "Event Requests" tab is correct on first paint, not just
     after the admin has already clicked into that tab once. */
  useEffect(loadRequests, [loadRequests]);

  const openAdd = () => {
    setForm(EMPTY); setEditing(null); setApprovingId(null);
    setImgFile(null); setImgPrev(''); setTagsStr(''); setError('');
    setTemplates({ participation: null, runner_up: null, winner: null });
    setModal('add');
  };

  const loadTemplates = (eventId) => {
    setTemplatesLoading(true);
    api.get(`/events/${eventId}/certificate-templates`)
      .then(d => {
        const byCategory = { participation: null, runner_up: null, winner: null };
        (d.templates || []).forEach(t => { byCategory[t.category] = t; });
        setTemplates(byCategory);
      })
      .catch(() => setTemplates({ participation: null, runner_up: null, winner: null }))
      .finally(() => setTemplatesLoading(false));
  };

  const openEdit = (ev) => {
    setForm({
      title: ev.title, clubId: ev.clubId || '', category: ev.category, status: ev.status,
      date: ev.date || '', startDate: ev.startDate ? ev.startDate.slice(0, 10) : '',
      time: ev.time || '', venue: ev.venue || '', description: ev.description || '',
      seats: ev.seats || '', highlight: ev.highlight || '', registrationUrl: ev.registrationUrl || '',
      isFree: ev.isFree !== false, feeAmount: ev.feeAmount || '',
      customFields: (ev.customFields || []).map(q => ({ ...q, optionsText: (q.options || []).join('\n') })),
    });
    setEditing(ev._id); setApprovingId(null);
    setImgPrev(ev.imageUrl || (ev.image ? `/images/${ev.image}` : ''));
    setImgFile(null);
    setTagsStr((ev.tags || []).join(', '));
    setError('');
    setModal('edit');
    loadTemplates(ev._id);
  };

  /* Pre-fill the event form from a coordinator request */
  const openApprove = (req) => {
    setForm({
      title:           req.title,
      clubId:          req.clubId || '',
      category:        req.category || 'general',
      status:          'upcoming',
      date:            req.date || '',
      startDate:       req.startDate ? String(req.startDate).slice(0, 10) : '',
      time:            req.time || '',
      venue:           req.venue || '',
      description:     req.description || '',
      seats:           req.seats || '',
      highlight:       req.highlight || '',
      registrationUrl: req.registrationUrl || '',
      isFree:          req.isFree !== false,
      feeAmount:       req.feeAmount || '',
      customFields:    [],
    });
    setTagsStr((req.tags || []).join(', '));
    setEditing(null);
    setApprovingId(req.id);
    setImgFile(null); setImgPrev(req.imageUrl || ''); setError('');
    setModal('approve');
  };

  const closeModal = () => {
    setModal(false); setImgFile(null); setImgPrev('');
    setError(''); setApprovingId(null);
  };

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setImgFile(f);
    setImgPrev(URL.createObjectURL(f));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return setError('Event title is required.');
    if (modal !== 'approve') {
      const qErr = questionsError(form.customFields);
      if (qErr) return setError(qErr);
    }
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      const { isFree, feeAmount, customFields, ...rest } = form;
      Object.entries(rest).forEach(([k, v]) => fd.append(k, v));
      fd.append('customFields', serializeQuestions(customFields));
      fd.append('isFree', isFree);
      fd.append('feeAmount', isFree ? 0 : Number(feeAmount) || 0);
      fd.append('tags', JSON.stringify(tagsStr.split(',').map(t => t.trim()).filter(Boolean)));
      if (imgFile) fd.append('image', imgFile);

      if (modal === 'approve') {
        /* Approve the coordinator's request — creates event + marks approved.
           Sent as FormData (not JSON) so a banner image picked here actually
           attaches to the created event instead of being silently dropped. */
        const approveFd = new FormData();
        approveFd.append('title',            form.title.trim());
        approveFd.append('clubId',           form.clubId || '');
        approveFd.append('category',         form.category);
        approveFd.append('status',           form.status);
        approveFd.append('date',             form.date);
        approveFd.append('start_date',       form.startDate);
        approveFd.append('time',             form.time);
        approveFd.append('venue',            form.venue);
        approveFd.append('description',      form.description);
        approveFd.append('seats',            form.seats);
        approveFd.append('tags',             tagsStr); // raw comma-separated string; backend splits it
        approveFd.append('highlight',        form.highlight);
        approveFd.append('registration_url', form.registrationUrl);
        approveFd.append('is_free',          isFree);
        approveFd.append('fee_amount',       isFree ? 0 : Number(feeAmount) || 0);
        if (imgFile) approveFd.append('image', imgFile);

        const { event: rawEvent } = await api.putForm(`/event-requests/${approvingId}/approve`, approveFd);
        setRequests(p => p.map(r => r.id === approvingId ? { ...r, status: 'approved' } : r));
        showToast('Request approved — event created successfully!');
        load(); // refresh events list
        /* Approve's response is a raw DB row, not run through the asEvent() mapper openEdit
           expects — refetch properly-shaped so template upload is available immediately. */
        const { event: fullEvent } = await api.get(`/events/${rawEvent.id}`);
        openEdit(fullEvent);
        return;
      } else if (modal === 'add') {
        const { event } = await api.postForm('/events', fd);
        load();
        openEdit(event); // transition straight into edit mode so cert templates can be added now
        return;
      } else {
        await api.putForm(`/events/${editing}`, fd);
        load();
      }
      closeModal();
    } catch (err) {
      setError(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/events/${deleteId}`);
      setDeleteId(null); load();
      /* Deleting an activity while its Galore umbrella's panel is open needs the
         activities list refreshed too — a no-op fetch when deleting anything else. */
      if (selectedGalore) { loadActivities(selectedGalore._id); loadDeptRegs(selectedGalore._id); }
    } catch (err) { setError(err.message); }
  };

  const handleToggleReg = async (ev) => {
    try {
      await api.patch(`/events/${ev._id}/registration`, { closed: !ev.registrationClosed });
      load();
      if (selectedGalore) loadActivities(selectedGalore._id);
    } catch (err) { setError(err.message); }
  };

  const handleToggleActivityReg = async (act) => {
    try {
      await api.patch(`/events/${act.id}/registration`, { closed: !act.registrationClosed });
      if (selectedGalore) loadActivities(selectedGalore._id);
    } catch (err) { setError(err.message); }
  };

  /* ── Sports Fiesta modal handlers ── */
  const openAddSF = () => {
    setSfForm(EMPTY_SF); setSfEditing(null);
    setSfImgFile(null); setSfImgPrev(''); setSfTagsStr(''); setSfError('');
    setSfModal('add');
  };

  const openEditSF = (ev) => {
    setSfForm({
      title: ev.title, clubId: ev.clubId || '', category: ev.category || 'sports', status: ev.status || 'upcoming',
      date: ev.date || '', startDate: ev.startDate ? ev.startDate.slice(0, 10) : '',
      time: ev.time || '', venue: ev.venue || '', description: ev.description || '',
      seats: ev.seats || '', highlight: ev.highlight || '', registrationUrl: ev.registrationUrl || '',
      isFree: ev.isFree !== false, feeAmount: ev.feeAmount || '',
      minTeamSize: ev.minTeamSize || '', teamSize: ev.teamSize || '', paymentLink: ev.paymentLink || '',
    });
    setSfEditing(ev._id);
    setSfImgPrev(ev.imageUrl || (ev.image ? `/images/${ev.image}` : ''));
    setSfImgFile(null); setSfTagsStr((ev.tags || []).join(', ')); setSfError('');
    setSfModal('edit');
  };

  const closeSFModal = () => {
    setSfModal(false); setSfImgFile(null); setSfImgPrev(''); setSfError('');
  };

  const handleSFFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setSfImgFile(f);
    setSfImgPrev(URL.createObjectURL(f));
  };

  const sfSet = (k) => (e) => setSfForm(p => ({ ...p, [k]: e.target.value }));

  const handleSaveSF = async (e) => {
    e.preventDefault();
    if (!sfForm.title.trim())        return setSfError('Event title is required.');
    if (!sfForm.minTeamSize || Number(sfForm.minTeamSize) < 1) return setSfError('Minimum number of players is required.');
    if (!sfForm.teamSize || Number(sfForm.teamSize) < 1)       return setSfError('Maximum number of players is required.');
    if (Number(sfForm.minTeamSize) > Number(sfForm.teamSize))  return setSfError('Minimum cannot be greater than the maximum.');
    setSfSaving(true); setSfError('');
    try {
      const fd = new FormData();
      const { isFree, feeAmount, ...rest } = sfForm;
      Object.entries(rest).forEach(([k, v]) => fd.append(k, v));
      fd.append('eventFormat', 'sports_fiesta');
      fd.append('isFree', isFree);
      fd.append('feeAmount', isFree ? 0 : Number(feeAmount) || 0);
      fd.append('tags', JSON.stringify(sfTagsStr.split(',').map(t => t.trim()).filter(Boolean)));
      if (sfImgFile) fd.append('image', sfImgFile);

      if (sfModal === 'add') {
        await api.postForm('/events', fd);
      } else {
        await api.putForm(`/events/${sfEditing}`, fd);
      }
      load();
      closeSFModal();
      showToast(sfModal === 'add' ? 'Sports Fiesta event created!' : 'Sports Fiesta event updated!');
    } catch (err) {
      setSfError(err.message || 'Failed to save.');
    } finally {
      setSfSaving(false);
    }
  };

  /* ── Galore handlers ── */
  const openAddGalore = () => {
    setGaloreEditing(null);
    setGaloreForm(EMPTY_GALORE);
    setGaloreImgFile(null); setGaloreImgPrev(''); setGaloreError('');
    setGaloreAssignments({});
    if (!galoreCatalog.length) {
      api.get('/events/galore/catalog').then(d => setGaloreCatalog(d.activities || [])).catch(() => setGaloreCatalog([]));
    }
    if (!galoreCoordinators.length) {
      api.get('/events/galore/coordinators').then(d => setGaloreCoordinators(d.coordinators || [])).catch(() => setGaloreCoordinators([]));
    }
    setGaloreModal(true);
  };
  /* Edit an existing Galore umbrella's own details (title/venue/date/description/
     image) — every activity's coordinator assignment was already locked in at
     creation and isn't touched here; re-assigning coordinators is a separate,
     later action, not part of editing the umbrella's info. */
  const openEditGalore = (ev) => {
    setGaloreEditing(ev._id);
    setGaloreForm({
      title:       ev.title || '',
      status:      ev.status || 'upcoming',
      date:        ev.date || '',
      startDate:   ev.startDate ? ev.startDate.slice(0, 10) : '',
      time:        ev.time || '',
      venue:       ev.venue || '',
      description: ev.description || '',
      seats:       ev.seats ?? '',
      highlight:   ev.highlight || '',
    });
    setGaloreImgFile(null); setGaloreImgPrev(ev.imageUrl || ''); setGaloreError('');
    setGaloreModal(true);
  };
  const closeGaloreModal = () => {
    setGaloreModal(false); setGaloreEditing(null); setGaloreImgFile(null); setGaloreImgPrev(''); setGaloreError('');
  };
  const handleGaloreFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setGaloreImgFile(f);
    setGaloreImgPrev(URL.createObjectURL(f));
  };
  const galoreSet = (k) => (e) => setGaloreForm(p => ({ ...p, [k]: e.target.value }));
  const setActivityCoordinator = (key) => (e) => setGaloreAssignments(p => ({ ...p, [key]: e.target.value }));

  const unassignedActivities = galoreCatalog.filter(a => !galoreAssignments[a.key]);

  const handleSaveGalore = async (e) => {
    e.preventDefault();
    if (!galoreForm.title.trim()) return setGaloreError('Event title is required.');
    if (!galoreEditing && unassignedActivities.length) {
      return setGaloreError(`Assign a coordinator for every activity first — missing: ${unassignedActivities.map(a => a.title).join(', ')}.`);
    }
    setGaloreSaving(true); setGaloreError('');
    try {
      if (galoreEditing) {
        const fd = new FormData();
        Object.entries(galoreForm).forEach(([k, v]) => fd.append(k, v));
        if (galoreImgFile) fd.append('image', galoreImgFile);
        const { event } = await api.putForm(`/events/${galoreEditing}`, fd);
        setEvents(p => p.map(e => e._id === event._id ? event : e));
        closeGaloreModal();
        showToast('Galore event updated!');
        return;
      }
      const fd = new FormData();
      Object.entries(galoreForm).forEach(([k, v]) => fd.append(k, v));
      fd.append('activityCoordinators', JSON.stringify(galoreAssignments));
      if (galoreImgFile) fd.append('image', galoreImgFile);

      const { event } = await api.postForm('/events/galore', fd);
      load();
      closeGaloreModal();
      showToast('Galore event created with every activity staffed!');
      openGaloreActivities(event);
    } catch (err) {
      setGaloreError(err.message || 'Failed to save.');
    } finally {
      setGaloreSaving(false);
    }
  };

  const loadActivities = useCallback((eventId) => {
    setActivitiesLoading(true);
    api.get(`/events/${eventId}/activities`)
      .then(d => setActivities(d.activities || []))
      .catch(() => setActivities([]))
      .finally(() => setActivitiesLoading(false));
  }, []);

  const loadDeptRegs = useCallback((eventId) => {
    setDeptRegsLoading(true);
    api.get(`/events/${eventId}/department-registrations`)
      .then(d => {
        const depts = d.departments || [];
        setDeptRegs(depts);
        setActiveDeptTab(prev => (prev && depts.some(x => x.dept === prev)) ? prev : (depts[0]?.dept || ''));
      })
      .catch(() => setDeptRegs([]))
      .finally(() => setDeptRegsLoading(false));
  }, []);

  const openGaloreActivities = (ev) => {
    setSelectedGalore(ev);
    setGaloreSubTab('activities');
    loadActivities(ev._id);
    loadDeptRegs(ev._id);
  };
  const closeGaloreActivities = () => { setSelectedGalore(null); setActivities([]); setDeptRegs([]); };

  /* Reject a coordinator request */
  const handleReject = async () => {
    if (!rejectModal) return;
    setRejecting(true);
    try {
      await api.put(`/event-requests/${rejectModal.id}/reject`, { admin_note: rejectNote.trim() });
      setRequests(p => p.map(r => r.id === rejectModal.id
        ? { ...r, status: 'rejected', adminNote: rejectNote.trim() } : r));
      setRejectModal(null); setRejectNote('');
      showToast('Request rejected.');
    } catch (err) {
      showToast(err.message || 'Failed to reject.');
    } finally {
      setRejecting(false);
    }
  };

  const sf = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  /* ── Registrations ── */
  const viewRegs = (ev) => {
    setRegEvent(ev);
    setRegs([]);
    setRegSearch('');
    setRegsTab('list');
    setRegsLoading(true);
    fetchAllPages(`/events/${ev._id}/registrations`, 'registrations')
      .then(({ items }) => setRegs(items))
      .catch(() => setRegs([]))
      .finally(() => setRegsLoading(false));

    setTeams([]);
    setExpandedTeams(new Set());
    setTeamsLoading(true);
    api.get(`/events/${ev._id}/teams`)
      .then(d => setTeams(d.teams || []))
      .catch(() => setTeams([]))
      .finally(() => setTeamsLoading(false));
  };

  /* ── Teams — same endpoints the coordinator's own Teams tab uses (see
     CoordEvents.jsx), so a change made from either side shows up on both. ── */
  const DIVISIONS = regEvent?.category === 'sports' ? ['boys', 'girls'] : ['open'];
  const DIVISION_LABEL = { boys: 'Boys', girls: 'Girls', open: 'Teams' };
  const teamsByDiv = {
    boys:  teams.filter(t => t.division !== 'girls' && t.division !== 'open'),
    girls: teams.filter(t => t.division === 'girls'),
    open:  teams.filter(t => t.division === 'open'),
  };

  const toggleTeamExpand = (team) =>
    setExpandedTeams(prev => {
      const set = new Set(prev);
      if (set.has(team.id)) {
        set.delete(team.id);
      } else {
        set.add(team.id);
        setTeamEdits(p => ({ ...p, [team.id]: { name: team.name, maxSize: String(team.maxSize) } }));
      }
      return set;
    });

  const handleCreateTeam = async (division) => {
    const name = newTeamName[division];
    if (!name?.trim() || !regEvent) return;
    setCreatingTeam(p => ({ ...p, [division]: true }));
    try {
      const { team } = await api.post(`/events/${regEvent._id}/teams`, {
        name: name.trim(), maxSize: Number(newTeamSize[division]) || 0, division,
      });
      setTeams(p => [...p, team]);
      setNewTeamName(p => ({ ...p, [division]: '' }));
      setNewTeamSize(p => ({ ...p, [division]: '' }));
      showToast('Team created — the coordinator has been notified.');
    } catch (err) {
      showToast(err.message || 'Failed to create team.');
    } finally {
      setCreatingTeam(p => ({ ...p, [division]: false }));
    }
  };

  const handleUpdateTeam = async (teamId) => {
    const edits = teamEdits[teamId];
    if (!edits?.name?.trim()) return;
    try {
      const { team } = await api.put(`/events/${regEvent._id}/teams/${teamId}`, {
        name: edits.name.trim(), maxSize: Number(edits.maxSize) || 0,
      });
      setTeams(p => p.map(t => t.id === teamId ? { ...t, name: team.name, maxSize: team.maxSize } : t));
      showToast('Team updated — the coordinator has been notified.');
    } catch (err) {
      showToast(err.message || 'Failed to update team.');
    }
  };

  const handleDeleteTeam = async (teamId) => {
    try {
      await api.delete(`/events/${regEvent._id}/teams/${teamId}`);
      setTeams(p => p.filter(t => t.id !== teamId));
      setExpandedTeams(prev => { const set = new Set(prev); set.delete(teamId); return set; });
      setTeamEdits(p => { const n = { ...p }; delete n[teamId]; return n; });
      showToast('Team deleted — the coordinator has been notified.');
    } catch (err) {
      showToast(err.message || 'Failed to delete team.');
    }
  };

  const handleToggleClear = async (teamId) => {
    try {
      const { isCleared } = await api.patch(`/events/${regEvent._id}/teams/${teamId}/clear`);
      setTeams(p => p.map(t => t.id === teamId ? { ...t, isCleared } : t));
    } catch (err) {
      showToast(err.message || 'Failed to update team.');
    }
  };

  const handleAddMember = async (teamId, registrationId) => {
    if (!registrationId) return;
    try {
      const { member } = await api.post(`/events/${regEvent._id}/teams/${teamId}/members`, { registrationId });
      setTeams(p => p.map(t => t.id === teamId ? { ...t, members: [...t.members, member] } : t));
      showToast('Member added — the coordinator has been notified.');
    } catch (err) {
      showToast(err.message || 'Failed to add member.');
    }
  };

  const handleRemoveMember = async (teamId, memberId) => {
    try {
      await api.delete(`/events/${regEvent._id}/teams/${teamId}/members/${memberId}`);
      setTeams(p => p.map(t => t.id === teamId ? { ...t, members: t.members.filter(m => m.id !== memberId) } : t));
      showToast('Member removed — the coordinator has been notified.');
    } catch (err) {
      showToast(err.message || 'Failed to remove member.');
    }
  };

  /* Registrations not yet assigned to any team, for the "add member" picker */
  const getUnassignedRegs = () => {
    const assigned = new Set(teams.flatMap(t => t.members.map(m => m.registrationId)));
    return regs.filter(r => !assigned.has(String(r.id)));
  };

  const exportCSV = () => {
    if (!regs.length) return;
    const qCols = answerColumns(regEvent, regs);
    const headers = ['#', 'Name', 'Enrollment No', 'Department', 'Course', 'Gender', 'Mobile', 'Email',
      ...qCols.map(c => csvCell(c.label)), 'Registered At'];
    const rows = regs.map((r, i) => [
      i + 1,
      `"${r.name || ''}"`,
      r.enrollment_no || '',
      r.dept || '',
      `"${r.course || ''}"`,
      r.gender || '',
      r.phone || '',
      isPlaceholderEmail(r.email) ? '' : (r.email || ''),
      ...qCols.map(c => csvCell(answerOf(r, c.id))),
      `"${r.registered_at ? new Date(r.registered_at).toLocaleString('en-IN') : ''}"`,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${regEvent?.title?.replace(/[^a-z0-9]/gi, '_')}_registrations.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* One column per extra registration question in the registrations table */
  const regQCols = regEvent ? answerColumns(regEvent, regs) : [];

  const filteredRegs = regs.filter(r => {
    if (!regSearch) return true;
    const q = regSearch.toLowerCase();
    return (r.name || '').toLowerCase().includes(q)
        || (r.enrollment_no || '').toLowerCase().includes(q)
        || (r.dept || '').toLowerCase().includes(q)
        || (r.email || '').toLowerCase().includes(q);
  });

  /* ── Edit a single registration's details — corrections propagate to any team
     roster this registrant is already part of, so coordinators/students see the
     fix wherever that name/enrollment number is displayed. Email is intentionally
     not editable — it anchors the registrant's identity across the platform.
     Shared by both the classic per-event Registrations panel (regs, raw DB field
     names) and the Galore "By Department" view (deptRegs, camelCase field names)
     — takes an explicit eventId since a department table can span many activities
     at once, unlike the single-event panel. */
  const [editingRegId, setEditingRegId] = useState(null);
  const [regEditForm,  setRegEditForm]  = useState(null);
  const [regSaving,    setRegSaving]    = useState(false);

  const startEditReg = (r) => {
    setEditingRegId(String(r.id ?? r.registrationId));
    setRegEditForm({
      name: r.name || '', enrollmentNo: r.enrollment_no ?? r.enrollmentNo ?? '',
      dept: r.dept || '', course: r.course || '',
      phone: r.phone || '', gender: r.gender || '',
    });
  };
  const cancelEditReg = () => { setEditingRegId(null); setRegEditForm(null); };

  const saveEditReg = async (regId, eventId) => {
    setRegSaving(true);
    try {
      const { registration } = await api.patch(`/events/${eventId}/registrations/${regId}`, regEditForm);
      setRegs(prev => prev.map(r => String(r.id) === String(regId) ? registration : r));
      setDeptRegs(prev => prev.map(d => ({
        ...d,
        registrants: d.registrants.map(r => r.registrationId === String(regId) ? {
          ...r,
          name: registration.name, enrollmentNo: registration.enrollment_no, dept: registration.dept,
          course: registration.course, phone: registration.phone, gender: registration.gender,
        } : r),
      })));
      cancelEditReg();
      showToast('Registration updated.');
    } catch (err) {
      showToast(err.message || 'Failed to update registration.');
    } finally {
      setRegSaving(false);
    }
  };

  /* ── Delete a single registration — works the same for any event format;
     for a Sports Fiesta team member this also removes them from their team
     (handled server-side), same as when a coordinator removes them via the
     Teams tab. deleteRegEventId pairs with deleteRegId so a department-view
     delete (which can target any of several activities) knows which one. */
  const [deleteRegId,       setDeleteRegId]       = useState(null);
  const [deleteRegEventId,  setDeleteRegEventId]  = useState(null);
  const [regDeleting,       setRegDeleting]       = useState(false);

  const handleDeleteReg = async () => {
    if (!deleteRegId) return;
    const eventId = deleteRegEventId || regEvent?._id;
    setRegDeleting(true);
    try {
      await api.delete(`/events/${eventId}/registrations/${deleteRegId}`);
      setRegs(prev => prev.filter(r => String(r.id) !== String(deleteRegId)));
      setDeptRegs(prev => prev.map(d => ({
        ...d,
        registrants: d.registrants.filter(r => r.registrationId !== String(deleteRegId)),
      })));
      setDeleteRegId(null); setDeleteRegEventId(null);
      showToast('Registration deleted.');
    } catch (err) {
      showToast(err.message || 'Failed to delete registration.');
    } finally {
      setRegDeleting(false);
    }
  };

  const upcoming = events.filter(ev => ev.status === 'upcoming');
  const past     = events.filter(ev => ev.status === 'past');

  const filtered = events.filter(ev => {
    const ms = statusF === 'all' || ev.status === statusF;
    const mq = !search || ev.title.toLowerCase().includes(search.toLowerCase())
                       || ev.club?.toLowerCase().includes(search.toLowerCase());
    return ms && mq;
  });

  /* "All Events" is split into 3 sub-tabs by event_format; legacy events
     (created before this feature) have no event_format set and fall back to
     'other', which keeps them exactly where they already were. */
  const otherEvents        = filtered.filter(ev => (ev.eventFormat || 'other') === 'other');
  const sportsFiestaEvents = filtered.filter(ev => ev.eventFormat === 'sports_fiesta');
  /* Only top-level Galore umbrellas here — their child activities (parentEventId
     set) live entirely inside the activities panel, never in this list. */
  const galoreEvents = filtered.filter(ev => ev.eventFormat === 'galore' && !ev.parentEventId);

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const displayReqs  = reqFilter === 'all' ? requests : requests.filter(r => r.status === reqFilter);

  return (
    <div className={s.page}>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position:'fixed', top:20, right:24, background:'#059669', color:'#fff',
          padding:'11px 20px', borderRadius:10, fontSize:'.875rem', fontWeight:600,
          zIndex:9999, boxShadow:'0 4px 20px rgba(0,0,0,.2)' }}>
          ✓ {toast}
        </div>
      )}

      {/* ── Header ── */}
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Events</h1>
          <p className={s.sub}>
            {pageTab === 'events'
              ? (loading ? 'Loading…' : `${events.length} events · ${upcoming.length} upcoming · ${past.length} past`)
              : `${requests.length} total requests · ${pendingCount} pending review`}
          </p>
        </div>
        {pageTab === 'events' && formatTab === 'other' && (
          <button className={s.addBtn} onClick={openAdd}>+ Add Event</button>
        )}
        {pageTab === 'events' && formatTab === 'sports_fiesta' && (
          <button className={s.addBtn} onClick={openAddSF}>+ Add Sports Fiesta Event</button>
        )}
        {pageTab === 'events' && formatTab === 'galore' && !selectedGalore && (
          <button className={s.addBtn} onClick={openAddGalore}>+ Add Galore Event</button>
        )}
      </div>

      {/* ── Page tabs ── */}
      <div className={s.statusTabs} style={{ marginBottom: 24, borderBottom: '2px solid #f0f0f5' }}>
        <button
          className={`${s.statusTab} ${pageTab === 'events' ? s.statusTabOn : ''}`}
          onClick={() => setPageTab('events')}>
          All Events {!loading && `(${events.length})`}
        </button>
        <button
          className={`${s.statusTab} ${pageTab === 'requests' ? s.statusTabOn : ''}`}
          onClick={() => setPageTab('requests')}>
          Event Requests
          {pendingCount > 0 && (
            <span style={{ marginLeft:6, background:'#dc2626', color:'#fff',
              fontSize:'.65rem', fontWeight:800, padding:'1px 7px',
              borderRadius:9, verticalAlign:'middle' }}>
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* ══════════════ EVENTS TAB ══════════════ */}
      {pageTab === 'events' && (<>
        {/* ── Event-format sub-tabs ── */}
        <div className={s.statusTabs} style={{ marginBottom: 20 }}>
          <button
            className={`${s.statusTab} ${formatTab === 'other' ? s.statusTabOn : ''}`}
            onClick={() => setFormatTab('other')}>
            Other Events {!loading && `(${otherEvents.length})`}
          </button>
          <button
            className={`${s.statusTab} ${formatTab === 'sports_fiesta' ? s.statusTabOn : ''}`}
            onClick={() => setFormatTab('sports_fiesta')}>
            Sports Fiesta {!loading && `(${sportsFiestaEvents.length})`}
          </button>
          <button
            className={`${s.statusTab} ${formatTab === 'galore' ? s.statusTabOn : ''}`}
            onClick={() => setFormatTab('galore')}>
            Galore
          </button>
        </div>

        {formatTab === 'other' && (<>
          <div className={s.filters}>
            <div className={s.searchWrap}>
              <svg className={s.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input className={s.searchInput} placeholder="Search events or organizers…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className={s.statusTabs}>
              {['all','upcoming','past'].map(st => (
                <button key={st}
                  className={`${s.statusTab} ${statusF === st ? s.statusTabOn : ''}`}
                  style={statusF === st && st === 'upcoming' ? { background:'#00c89618', color:'#007a5e', borderColor:'#00c89640' }
                       : statusF === st && st === 'past'     ? { background:'#63636314', color:'#555', borderColor:'#88888830' }
                       : {}}
                  onClick={() => setStatusF(st)}>
                  {st === 'all' ? `All (${events.length})` : st === 'upcoming' ? `Upcoming (${upcoming.length})` : `Past (${past.length})`}
                </button>
              ))}
            </div>
          </div>

          {error && !modal && <div className={s.errorBar}>{error}</div>}

          {loading ? (
            <div className={s.grid}>{Array.from({ length:6 }).map((_,i) => <div key={i} className={s.skeleton} />)}</div>
          ) : otherEvents.length === 0 ? (
            <div className={s.empty}>
              <p>No events found</p>
              <span>Try a different filter or <button onClick={openAdd}>add a new event</button></span>
            </div>
          ) : (
            <div className={s.grid}>
              {otherEvents.map(ev => (
                <EventCard key={ev._id} ev={ev} onEdit={openEdit} onDelete={setDeleteId} onViewRegs={viewRegs} onToggleReg={handleToggleReg} />
              ))}
            </div>
          )}
        </>)}

        {formatTab === 'sports_fiesta' && (<>
          <div className={s.filters}>
            <div className={s.searchWrap}>
              <svg className={s.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input className={s.searchInput} placeholder="Search Sports Fiesta events…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {sfError && !sfModal && <div className={s.errorBar}>{sfError}</div>}

          {loading ? (
            <div className={s.grid}>{Array.from({ length:3 }).map((_,i) => <div key={i} className={s.skeleton} />)}</div>
          ) : sportsFiestaEvents.length === 0 ? (
            <div className={s.empty}>
              <p>No Sports Fiesta events yet</p>
              <span>Try a different search or <button onClick={openAddSF}>add a new Sports Fiesta event</button></span>
            </div>
          ) : (
            <div className={s.grid}>
              {sportsFiestaEvents.map(ev => (
                <SportsFiestaCard key={ev._id} ev={ev} onEdit={openEditSF} onDelete={setDeleteId} onViewRegs={viewRegs} onToggleReg={handleToggleReg} />
              ))}
            </div>
          )}
        </>)}

        {formatTab === 'galore' && (
          selectedGalore ? (
            <div>
              <button className={s.regsBtn} onClick={closeGaloreActivities} style={{ marginBottom: 16 }}>
                ← Back to Galore Events
              </button>
              <h2 style={{ margin: '0 0 4px' }}>{selectedGalore.title}</h2>

              <div className={s.statusTabs} style={{ marginBottom: 20 }}>
                <button className={`${s.statusTab} ${galoreSubTab === 'activities' ? s.statusTabOn : ''}`}
                  onClick={() => setGaloreSubTab('activities')}>
                  Activities {!activitiesLoading && `(${activities.length})`}
                </button>
                <button className={`${s.statusTab} ${galoreSubTab === 'departments' ? s.statusTabOn : ''}`}
                  onClick={() => setGaloreSubTab('departments')}>
                  By Department
                </button>
              </div>

              {galoreSubTab === 'activities' ? (
                activitiesLoading ? (
                  <div className={s.grid}>{Array.from({ length: 3 }).map((_, i) => <div key={i} className={s.skeleton} />)}</div>
                ) : activities.length === 0 ? (
                  <div className={s.empty}><p>No activities found for this event.</p></div>
                ) : (
                  <div className={s.grid}>
                    {activities.map(act => (
                      <div key={act.id} className={s.card}>
                        <div className={s.cardBody}>
                          <div className={s.cardTitle}>{act.title}</div>
                          <div className={s.cardClub}>
                            {GALORE_CATEGORY_LABEL[act.category] || act.category} · {act.participationType === 'team' ? 'Team' : 'Individual'}
                          </div>
                          <div className={s.cardMeta}>
                            <span>{act.registrationCount} registered</span>
                            {act.participationType === 'team' && <span>{act.teamCount} teams</span>}
                          </div>
                        </div>
                        <div className={s.cardActions}>
                          <button className={s.regsBtn} onClick={() => viewRegs(act)}>Registrations</button>
                          <button className={s.delBtn} onClick={() => setDeleteId(act.id)}>Delete</button>
                        </div>
                        <div className={s.cardActions} style={{ borderTop: 'none', paddingTop: 0 }}>
                          <button
                            className={s.regsBtn}
                            onClick={() => handleToggleActivityReg(act)}
                            style={{ width: '100%' }}
                          >
                            {act.registrationClosed ? 'Reopen Registration' : 'Close Registration'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                deptRegsLoading ? (
                  <div className={s.regsEmpty}>Loading…</div>
                ) : deptRegs.length === 0 ? (
                  <div className={s.empty}><p>No registrations recorded yet.</p></div>
                ) : (
                  <>
                    <div className={s.statusTabs} style={{ marginBottom: 16, flexWrap: 'wrap' }}>
                      {deptRegs.map(d => (
                        <button key={d.dept}
                          className={`${s.statusTab} ${activeDeptTab === d.dept ? s.statusTabOn : ''}`}
                          onClick={() => setActiveDeptTab(d.dept)}>
                          {d.dept} ({d.registrants.length})
                        </button>
                      ))}
                    </div>
                    {(() => {
                      const active = deptRegs.find(d => d.dept === activeDeptTab);
                      const list = active?.registrants || [];
                      if (list.length === 0) {
                        return <div className={s.regsEmpty}>No registrations for {activeDeptTab} yet.</div>;
                      }
                      /* Group this department's registrants by activity — each
                         activity renders as its own heading + table, matching
                         how a coordinator would actually read a roster sheet. */
                      const byActivity = new Map();
                      for (const r of list) {
                        if (!byActivity.has(r.eventTitle)) byActivity.set(r.eventTitle, { category: r.category, rows: [] });
                        byActivity.get(r.eventTitle).rows.push(r);
                      }
                      const CAT_ORDER = { sports: 0, cultural: 1, academic: 2 };
                      const groups = [...byActivity.entries()].sort(([aTitle, a], [bTitle, b]) => {
                        const ca = CAT_ORDER[a.category] ?? 9, cb = CAT_ORDER[b.category] ?? 9;
                        return ca !== cb ? ca - cb : aTitle.localeCompare(bTitle);
                      });
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                          {groups.map(([activityTitle, { category, rows }]) => (
                            <div key={activityTitle}>
                              <h3 style={{ margin: '0 0 8px', fontSize: '1.05rem' }}>
                                {activityTitle}
                                <span style={{ marginLeft: 8, fontSize: '.75rem', fontWeight: 500, color: '#6b7280' }}>
                                  {GALORE_CATEGORY_LABEL[category] || category} · {rows.length} registered
                                </span>
                              </h3>
                              <div className={s.regsTableWrap}>
                                <table className={s.regsTable}>
                                  <thead>
                                    <tr>
                                      <th>#</th><th>Name</th><th>Enrollment No.</th><th>Gender</th><th>Course</th>
                                      <th>Mobile</th><th>Email</th><th>Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((r, i) => {
                                      const isEditing = editingRegId === String(r.registrationId);
                                      return (
                                        <tr key={r.registrationId}>
                                          <td className={s.regsNum}>{i + 1}</td>
                                          {isEditing ? (
                                            <>
                                              <td><input className={s.regsEditInput} value={regEditForm.name}
                                                onChange={e => setRegEditForm(f => ({ ...f, name: e.target.value }))} /></td>
                                              <td><input className={s.regsEditInput} value={regEditForm.enrollmentNo}
                                                onChange={e => setRegEditForm(f => ({ ...f, enrollmentNo: e.target.value }))} /></td>
                                              <td>
                                                <select className={s.regsEditInput} value={regEditForm.gender}
                                                  onChange={e => setRegEditForm(f => ({ ...f, gender: e.target.value }))}>
                                                  <option value="">—</option>
                                                  <option value="M">M</option>
                                                  <option value="F">F</option>
                                                </select>
                                              </td>
                                              <td><input className={s.regsEditInput} value={regEditForm.course}
                                                onChange={e => setRegEditForm(f => ({ ...f, course: e.target.value }))} /></td>
                                              <td><input className={s.regsEditInput} value={regEditForm.phone}
                                                onChange={e => setRegEditForm(f => ({ ...f, phone: e.target.value }))} /></td>
                                            </>
                                          ) : (
                                            <>
                                              <td>{r.name || '—'}</td>
                                              <td>{r.enrollmentNo || '—'}</td>
                                              <td>{r.gender || '—'}</td>
                                              <td>{r.course || '—'}</td>
                                              <td>{r.phone || '—'}</td>
                                            </>
                                          )}
                                          <td>{r.email || '—'}</td>
                                          <td>
                                            {isEditing ? (
                                              <div style={{ display: 'flex', gap: 6 }}>
                                                <button className={s.csvBtn} disabled={regSaving} onClick={() => saveEditReg(r.registrationId, r.eventId)}>
                                                  {regSaving ? 'Saving…' : 'Save'}
                                                </button>
                                                <button className={s.closeBtn} disabled={regSaving} onClick={cancelEditReg}>✕</button>
                                              </div>
                                            ) : (
                                              <div style={{ display: 'flex', gap: 6 }}>
                                                <button className={s.csvBtn} onClick={() => startEditReg(r)}>Edit</button>
                                                <button className={s.delBtn} onClick={() => { setDeleteRegId(String(r.registrationId)); setDeleteRegEventId(r.eventId); }}>Delete</button>
                                              </div>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </>
                )
              )}
            </div>
          ) : (
            <div className={s.grid}>
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <div key={i} className={s.skeleton} />)
              ) : galoreEvents.length === 0 ? (
                <div className={s.empty}>
                  <p>No Galore events yet</p>
                  <span>Try a different search or <button onClick={openAddGalore}>add a new Galore event</button></span>
                </div>
              ) : (
                galoreEvents.map(ev => (
                  <div key={ev._id} className={s.card}>
                    <div className={s.cardImg}>
                      {ev.imageUrl ? <img src={ev.imageUrl} alt={ev.title} loading="lazy" /> : <div className={s.cardImgFallback}>Banner</div>}
                    </div>
                    <div className={s.cardBody}>
                      <div className={s.cardTitle}>{ev.title}</div>
                      <ReadMore as="div" text={ev.description} limit={100}
                        style={{ fontSize: '.8rem', color: '#6b7280', lineHeight: 1.45, margin: '4px 0 6px' }} />
                      <div className={s.cardMeta}>
                        {ev.date && <span>Date: {ev.date}</span>}
                        {ev.venue && <span>Venue: {ev.venue}</span>}
                      </div>
                    </div>
                    <div className={s.cardActions}>
                      <button className={s.regsBtn} onClick={() => openGaloreActivities(ev)}>Manage Activities</button>
                      <button className={s.editBtn} onClick={() => openEditGalore(ev)}>Edit</button>
                      <button className={s.delBtn} onClick={() => setDeleteId(ev._id)}>Delete</button>
                    </div>
                    <div className={s.cardActions} style={{ borderTop: 'none', paddingTop: 0 }}>
                      <button
                        className={s.regsBtn}
                        onClick={() => handleToggleReg(ev)}
                        style={{ width: '100%' }}
                        title={ev.registrationClosed ? 'Let students register for this Galore event again' : 'Stop new registrations for this Galore event (each activity can also be closed individually)'}
                      >
                        {ev.registrationClosed ? 'Reopen Registration' : 'Close Registration'}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )
        )}
      </>)}

      {/* ══════════════ REQUESTS TAB ══════════════ */}
      {pageTab === 'requests' && (<>
        {/* Filter strip */}
        <div className={s.statusTabs} style={{ marginBottom:20 }}>
          {[['all','All'],['pending','Pending'],['pending_fc','With Faculty Coordinator'],['approved','Approved'],['rejected','Rejected']].map(([val, label]) => (
            <button key={val}
              className={`${s.statusTab} ${reqFilter === val ? s.statusTabOn : ''}`}
              onClick={() => setReqFilter(val)}>
              {label} ({val === 'all' ? requests.length : requests.filter(r => r.status === val).length})
            </button>
          ))}
        </div>

        {reqLoading ? (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {[1,2,3].map(i => <div key={i} className={s.skeleton} style={{ height:160 }} />)}
          </div>
        ) : displayReqs.length === 0 ? (
          <div className={s.empty}>
            <div style={{ fontSize:'2rem', marginBottom:10 }}>📋</div>
            <p>No {reqFilter !== 'all' ? reqFilter : ''} requests</p>
            <span>Coordinators submit event requests here for your review.</span>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {displayReqs.map(req => {
              const st = REQ_STATUS_META[req.status] || REQ_STATUS_META.pending;
              return (
                <div key={req.id} style={{
                  background:'#fff', border:'1.5px solid #f0f0f5',
                  borderRadius:12, padding:'18px 20px',
                  boxShadow:'0 1px 6px rgba(0,0,0,.04)'
                }}>
                  {req.imageUrl && (
                    <img src={req.imageUrl} alt="" style={{ width:'100%', height:160, objectFit:'cover',
                      borderRadius:10, marginBottom:14 }} />
                  )}
                  {/* Request head */}
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:10, flexWrap:'wrap' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:4 }}>
                        <span style={{ fontSize:'.95rem', fontWeight:700, color:'#0f172a' }}>{req.title}</span>
                        <span style={{ fontSize:'.7rem', fontWeight:700, padding:'2px 10px', borderRadius:20, background:st.bg, color:st.color }}>
                          {st.label}
                        </span>
                        {req.isFree
                          ? <span style={{ fontSize:'.7rem', fontWeight:800, padding:'2px 9px', borderRadius:20, background:'#ecfdf5', color:'#059669' }}>FREE</span>
                          : <span style={{ fontSize:'.7rem', fontWeight:800, padding:'2px 9px', borderRadius:20, background:'#fffbeb', color:'#d97706' }}>₹{req.feeAmount} fee</span>
                        }
                      </div>
                      <div style={{ fontSize:'.78rem', color:'#6b7280' }}>
                        From <strong>{req.coordinatorName}</strong> · {req.clubName} · {new Date(req.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:5, fontSize:'.72rem', color:'#7c3aed', fontWeight:600 }}>
                        {requestChain(req).join('  →  ')}
                        {req.fcReviewedByName && <span style={{ color:'#9ca3af', fontWeight:500 }}>&nbsp;(by {req.fcReviewedByName})</span>}
                      </div>
                    </div>
                    {/* Action buttons */}
                    {req.status === 'pending' && (
                      <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                        <button onClick={() => openApprove(req)} style={{
                          padding:'7px 16px', background:'#635bff', color:'#fff',
                          border:'none', borderRadius:8, fontSize:'.82rem', fontWeight:700, cursor:'pointer'
                        }}>
                          Review &amp; Approve
                        </button>
                        <button onClick={() => { setRejectModal({ id: req.id, title: req.title }); setRejectNote(''); }} style={{
                          padding:'7px 14px', background:'#fff', color:'#dc2626',
                          border:'1.5px solid #fca5a5', borderRadius:8, fontSize:'.82rem', fontWeight:600, cursor:'pointer'
                        }}>
                          Reject
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <ReadMore text={req.description} limit={200}
                    style={{ fontSize:'.83rem', color:'#4b5563', lineHeight:1.5, margin:'0 0 10px' }} />

                  {/* Details row */}
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'8px 18px', fontSize:'.78rem', color:'#6b7280' }}>
                    {req.startDate && <span>Date: {new Date(req.startDate).toLocaleDateString('en-IN',{ day:'numeric', month:'short', year:'numeric' })}</span>}
                    {req.time      && <span>Time: {req.time}</span>}
                    {req.venue     && <span>Venue: {req.venue}</span>}
                    {req.seats     && <span>Seats: {req.seats}</span>}
                    {req.category  && <span>Category: {CAT_LABEL[req.category] || req.category}</span>}
                    {req.tags?.length > 0 && <span>Tags: {req.tags.join(', ')}</span>}
                  </div>

                  {/* Proposal details — everything the coordinator submitted */}
                  <div style={{ marginTop:10, background:'#f9fafb', border:'1px solid #e5e7eb',
                    borderRadius:8, padding:'10px 12px', display:'flex', flexDirection:'column', gap:6 }}>
                    <div style={{ fontSize:'.78rem', color:'#4b5563' }}>
                      <strong>Objective:</strong> {req.objective || '—'}
                    </div>
                    <div style={{ fontSize:'.78rem', color:'#4b5563' }}>
                      <strong>Expected outcome:</strong> {req.expectedOutcome || '—'}
                    </div>
                    <div style={{ fontSize:'.78rem', color:'#4b5563' }}>
                      <strong>Related to a special day:</strong> {req.isSpecialDay ? (req.specialDayName || 'Yes') : 'No'}
                    </div>
                    <div style={{ fontSize:'.78rem', color:'#4b5563' }}>
                      <strong>Who can participate:</strong> {req.targetAudience || '—'}
                    </div>
                    <div style={{ fontSize:'.78rem', color:'#4b5563' }}>
                      <strong>Expectations from university:</strong> {req.universityExpectations || '—'}
                    </div>
                  </div>

                  {/* Rejection note — from whichever stage actually rejected it */}
                  {req.status === 'rejected' && req.adminNote && (
                    <div style={{ marginTop:10, background:'#fef2f2', border:'1px solid #fecaca',
                      borderRadius:8, padding:'8px 12px', fontSize:'.8rem', color:'#7f1d1d' }}>
                      <strong>Rejected by Admin:</strong> {req.adminNote}
                    </div>
                  )}
                  {req.status === 'rejected' && !req.adminNote && req.fcNote && (
                    <div style={{ marginTop:10, background:'#f5f3ff', border:'1px solid #ddd6fe',
                      borderRadius:8, padding:'8px 12px', fontSize:'.8rem', color:'#4c1d95' }}>
                      <strong>Rejected by Faculty Coordinator{req.fcReviewedByName ? ` (${req.fcReviewedByName})` : ''}:</strong> {req.fcNote}
                    </div>
                  )}
                  {req.status === 'rejected' && !req.adminNote && !req.fcNote && req.fcReviewedByName && (
                    <div style={{ marginTop:10, background:'#f5f3ff', border:'1px solid #ddd6fe',
                      borderRadius:8, padding:'8px 12px', fontSize:'.8rem', color:'#4c1d95' }}>
                      Rejected by Faculty Coordinator <strong>{req.fcReviewedByName}</strong>.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </>)}

      {/* ══ Add / Edit / Approve Modal ══ */}
      {modal && (
        <div className={s.overlay} onClick={closeModal}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <div>
                <div className={s.modalTag}>
                  {modal === 'add' ? 'New Event' : modal === 'approve' ? 'Review & Approve Request' : 'Edit Event'}
                </div>
                <h2 className={s.modalTitle}>
                  {modal === 'add' ? 'Add New Event' : modal === 'approve' ? form.title || 'Approve Event' : form.title || 'Edit Event'}
                </h2>
                {modal === 'approve' && (
                  <p style={{ fontSize:'.78rem', color:'#059669', margin:'4px 0 0', fontWeight:500 }}>
                    All fields are pre-filled from the coordinator's request. Edit if needed, then approve.
                  </p>
                )}
              </div>
              <button className={s.closeBtn} onClick={closeModal}>✕</button>
            </div>

            <form onSubmit={handleSave} className={s.form}>
              {/* Image upload */}
              <div className={s.imgSection}>
                <div className={s.imgBox} onClick={() => fileRef.current.click()}>
                  {imgPrev
                    ? <img src={imgPrev} alt="preview" className={s.imgPreview} />
                    : <div className={s.imgPlaceholder}><span>Click to upload banner</span></div>
                  }
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleFile} />
                <div className={s.imgHint}>JPG, PNG, WEBP · max 10 MB · Recommended: 16:9</div>
              </div>

              <div className={s.field}>
                <label>Event Title <span className={s.req}>*</span></label>
                <input value={form.title} onChange={sf('title')} placeholder="e.g. Galore 2027 — Annual Mega Fest" required />
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Club / Organizer</label>
                  <select value={form.clubId} onChange={sf('clubId')}>
                    <option value="">SOAC · RK University (non-club event)</option>
                    {clubs.map(cl => (
                      <option key={cl._id || cl.id} value={cl._id || cl.id}>{cl.name}</option>
                    ))}
                  </select>
                </div>
                <div className={s.field}>
                  <label>Category</label>
                  <select value={form.category} onChange={sf('category')}>
                    {CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c] || c}</option>)}
                  </select>
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Status</label>
                  <select value={form.status} onChange={sf('status')}>
                    {STATUS.map(st => <option key={st} value={st}>{st.charAt(0).toUpperCase() + st.slice(1)}</option>)}
                  </select>
                </div>
                <div className={s.field}>
                  <label>Start Date</label>
                  <input type="date" value={form.startDate} onChange={sf('startDate')} />
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Display Date</label>
                  <input value={form.date} onChange={sf('date')} placeholder="e.g. Feb 2–8, 2027" />
                </div>
                <div className={s.field}>
                  <label>Time</label>
                  <input value={form.time} onChange={sf('time')} placeholder="e.g. 9:00 AM onwards" />
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Venue</label>
                  <input value={form.venue} onChange={sf('venue')} placeholder="e.g. RKU Main Campus" />
                </div>
                <div className={s.field}>
                  <label>Seats / Availability</label>
                  <input value={form.seats} onChange={sf('seats')} placeholder="e.g. 180 seats left" />
                </div>
              </div>

              <div className={s.field}>
                <label>Description</label>
                <textarea rows={3} value={form.description} onChange={sf('description')} placeholder="Event description…" />
              </div>

              {/* ── Registration Fee ── */}
              <div style={{ background:'#f9fafb', border:'1.5px solid #e5e7eb', borderRadius:10, padding:'14px 16px' }}>
                <div style={{ fontSize:'.78rem', fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:10 }}>
                  Registration Fee
                </div>
                <div style={{ display:'flex', gap:8, marginBottom: form.isFree ? 0 : 12 }}>
                  {[{ val:true, label:'🎟 Free Entry', active:'#ecfdf5', border:'#059669', text:'#059669' },
                    { val:false, label:'💳 Paid Event', active:'#fffbeb', border:'#d97706', text:'#d97706' }].map(opt => (
                    <button key={String(opt.val)} type="button"
                      onClick={() => setForm(p => ({ ...p, isFree: opt.val, feeAmount: opt.val ? '' : p.feeAmount }))}
                      style={{
                        flex:1, padding:'8px 12px', border:'1.5px solid',
                        borderColor: form.isFree === opt.val ? opt.border : '#e5e7eb',
                        borderRadius:8, background: form.isFree === opt.val ? opt.active : '#fff',
                        color: form.isFree === opt.val ? opt.text : '#6b7280',
                        fontSize:'.83rem', fontWeight:600, cursor:'pointer', transition:'all .14s',
                      }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {!form.isFree && (
                  <div className={s.field}>
                    <label>Fee Amount <span className={s.req}>*</span></label>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontWeight:700, fontSize:'1rem', color:'#374151' }}>₹</span>
                      <input type="number" min="1" step="1" style={{ flex:1, maxWidth:160 }}
                        value={form.feeAmount}
                        onChange={e => setForm(p => ({ ...p, feeAmount: e.target.value }))}
                        placeholder="e.g. 100" required={!form.isFree} />
                      <span style={{ fontSize:'.78rem', color:'#9ca3af', whiteSpace:'nowrap' }}>INR per student</span>
                    </div>
                  </div>
                )}
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Tags <span className={s.hint}>(comma-separated)</span></label>
                  <input value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="e.g. Mega Fest, 7 Days, All Clubs" />
                </div>
                <div className={s.field}>
                  <label>Highlight <span className={s.hint}>(past events)</span></label>
                  <input value={form.highlight} onChange={sf('highlight')} placeholder="e.g. Best Edition Yet" />
                </div>
              </div>

              {modal === 'approve' ? (
                <div style={{ fontSize:'.78rem', color:'#6b7280', background:'#f9fafb', border:'1.5px dashed #e5e7eb', borderRadius:10, padding:'10px 14px' }}>
                  Need extra registration questions for this event? Approve it first — the edit form opens straight after, where you can add them.
                </div>
              ) : (
                <QuestionBuilder
                  questions={form.customFields}
                  onChange={(qs) => setForm(p => ({ ...p, customFields: qs }))} />
              )}

              {editing && (
                <div style={{ background:'#f9fafb', border:'1.5px solid #e5e7eb', borderRadius:10, padding:'14px 16px' }}>
                  <div style={{ fontSize:'.78rem', fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:10 }}>
                    Certificate Templates
                  </div>
                  {templatesLoading ? (
                    <div style={{ fontSize:'.8rem', color:'#9ca3af' }}>Loading templates…</div>
                  ) : (
                    <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:12 }}>
                      <CertTemplateEditor eventId={editing} category="participation" label="Certificate of Participation"
                        template={templates.participation}
                        onUpdate={(cat, t) => setTemplates(p => ({ ...p, [cat]: t }))} />
                      <CertTemplateEditor eventId={editing} category="runner_up" label="Certificate of Runner-up"
                        template={templates.runner_up}
                        onUpdate={(cat, t) => setTemplates(p => ({ ...p, [cat]: t }))} />
                      <CertTemplateEditor eventId={editing} category="winner" label="Certificate of Winner"
                        template={templates.winner}
                        onUpdate={(cat, t) => setTemplates(p => ({ ...p, [cat]: t }))} />
                    </div>
                  )}
                </div>
              )}

              {error && <div className={s.formError}>{error}</div>}

              <div className={s.modalFooter}>
                <button type="button" className={s.cancelBtn} onClick={closeModal}>Cancel</button>
                <button type="submit" className={s.saveBtn} disabled={saving}>
                  {saving ? 'Saving…'
                    : modal === 'approve' ? 'Approve & Publish Event'
                    : modal === 'add'     ? 'Create Event'
                    : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ Sports Fiesta Add / Edit Modal ══ */}
      {sfModal && (
        <div className={s.overlay} onClick={closeSFModal}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <div>
                <div className={s.modalTag}>
                  {sfModal === 'add' ? 'New Sports Fiesta Event' : 'Edit Sports Fiesta Event'}
                </div>
                <h2 className={s.modalTitle}>
                  {sfModal === 'add' ? 'Add Sports Fiesta Event' : sfForm.title || 'Edit Sports Fiesta Event'}
                </h2>
              </div>
              <button className={s.closeBtn} onClick={closeSFModal}>✕</button>
            </div>

            <form onSubmit={handleSaveSF} className={s.form}>
              {/* Image upload */}
              <div className={s.imgSection}>
                <div className={s.imgBox} onClick={() => sfFileRef.current.click()}>
                  {sfImgPrev
                    ? <img src={sfImgPrev} alt="preview" className={s.imgPreview} />
                    : <div className={s.imgPlaceholder}><span>Click to upload banner</span></div>
                  }
                </div>
                <input ref={sfFileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleSFFile} />
                <div className={s.imgHint}>JPG, PNG, WEBP · max 10 MB · Recommended: 16:9</div>
              </div>

              <div className={s.field}>
                <label>Event Title <span className={s.req}>*</span></label>
                <input value={sfForm.title} onChange={sfSet('title')} placeholder="e.g. Sports Fiesta 2027 — Basketball" required />
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Club / Organizer</label>
                  <select value={sfForm.clubId} onChange={sfSet('clubId')}>
                    <option value="">SOAC · RK University (non-club event)</option>
                    {clubs.map(cl => (
                      <option key={cl._id || cl.id} value={cl._id || cl.id}>{cl.name}</option>
                    ))}
                  </select>
                </div>
                <div className={s.field}>
                  <label>Category</label>
                  <select value={sfForm.category} onChange={sfSet('category')}>
                    {CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c] || c}</option>)}
                  </select>
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Status</label>
                  <select value={sfForm.status} onChange={sfSet('status')}>
                    {STATUS.map(st => <option key={st} value={st}>{st.charAt(0).toUpperCase() + st.slice(1)}</option>)}
                  </select>
                </div>
                <div className={s.field}>
                  <label>Start Date</label>
                  <input type="date" value={sfForm.startDate} onChange={sfSet('startDate')} />
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Display Date</label>
                  <input value={sfForm.date} onChange={sfSet('date')} placeholder="e.g. Feb 2–8, 2027" />
                </div>
                <div className={s.field}>
                  <label>Time</label>
                  <input value={sfForm.time} onChange={sfSet('time')} placeholder="e.g. 9:00 AM onwards" />
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Venue</label>
                  <input value={sfForm.venue} onChange={sfSet('venue')} placeholder="e.g. RKU Main Campus" />
                </div>
                <div className={s.field}>
                  <label>Seats / Availability</label>
                  <input value={sfForm.seats} onChange={sfSet('seats')} placeholder="e.g. 180 seats left" />
                </div>
              </div>

              <div className={s.field}>
                <label>Description</label>
                <textarea rows={3} value={sfForm.description} onChange={sfSet('description')} placeholder="Event description…" />
              </div>

              {/* ── Registration Fee ── */}
              <div style={{ background:'#f9fafb', border:'1.5px solid #e5e7eb', borderRadius:10, padding:'14px 16px' }}>
                <div style={{ fontSize:'.78rem', fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:10 }}>
                  Registration Fee
                </div>
                <div style={{ display:'flex', gap:8, marginBottom: sfForm.isFree ? 0 : 12 }}>
                  {[{ val:true, label:'🎟 Free Entry', active:'#ecfdf5', border:'#059669', text:'#059669' },
                    { val:false, label:'💳 Paid Event', active:'#fffbeb', border:'#d97706', text:'#d97706' }].map(opt => (
                    <button key={String(opt.val)} type="button"
                      onClick={() => setSfForm(p => ({ ...p, isFree: opt.val, feeAmount: opt.val ? '' : p.feeAmount }))}
                      style={{
                        flex:1, padding:'8px 12px', border:'1.5px solid',
                        borderColor: sfForm.isFree === opt.val ? opt.border : '#e5e7eb',
                        borderRadius:8, background: sfForm.isFree === opt.val ? opt.active : '#fff',
                        color: sfForm.isFree === opt.val ? opt.text : '#6b7280',
                        fontSize:'.83rem', fontWeight:600, cursor:'pointer', transition:'all .14s',
                      }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {!sfForm.isFree && (
                  <div className={s.field}>
                    <label>Fee Amount <span className={s.req}>*</span></label>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontWeight:700, fontSize:'1rem', color:'#374151' }}>₹</span>
                      <input type="number" min="1" step="1" style={{ flex:1, maxWidth:160 }}
                        value={sfForm.feeAmount}
                        onChange={e => setSfForm(p => ({ ...p, feeAmount: e.target.value }))}
                        placeholder="e.g. 100" required={!sfForm.isFree} />
                      <span style={{ fontSize:'.78rem', color:'#9ca3af', whiteSpace:'nowrap' }}>INR per student</span>
                    </div>
                  </div>
                )}
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Tags <span className={s.hint}>(comma-separated)</span></label>
                  <input value={sfTagsStr} onChange={e => setSfTagsStr(e.target.value)} placeholder="e.g. Mega Fest, 7 Days, All Clubs" />
                </div>
                <div className={s.field}>
                  <label>Highlight <span className={s.hint}>(past events)</span></label>
                  <input value={sfForm.highlight} onChange={sfSet('highlight')} placeholder="e.g. Best Edition Yet" />
                </div>
              </div>

              {/* ── Sports Fiesta specific — the captain fills in their own contact
                   details and team member names on the public event page; the
                   admin only decides the roster-size cap and the payment link. ── */}
              <div style={{ background:'#f9fafb', border:'1.5px solid #e5e7eb', borderRadius:10, padding:'14px 16px', display:'flex', flexDirection:'column', gap:12 }}>
                <div style={{ fontSize:'.78rem', fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'.04em' }}>
                  Team
                </div>
                <div className={s.row2} style={{ marginBottom: 0 }}>
                  <div className={s.field} style={{ marginBottom: 0 }}>
                    <label>Min Players <span className={s.req}>*</span></label>
                    <input type="number" min="1" step="1" value={sfForm.minTeamSize} onChange={sfSet('minTeamSize')}
                      placeholder="e.g. 3" required />
                  </div>
                  <div className={s.field} style={{ marginBottom: 0 }}>
                    <label>Max Players <span className={s.req}>*</span></label>
                    <input type="number" min="1" step="1" value={sfForm.teamSize} onChange={sfSet('teamSize')}
                      placeholder="e.g. 5" required />
                  </div>
                </div>
                <p style={{ fontSize:'.76rem', color:'#9ca3af', margin:0 }}>
                  The captain fills in their own contact details and team member names on the public event page — this just sets how many players (including themselves) each team must have.
                </p>
                <div className={s.field} style={{ marginBottom: 0 }}>
                  <label>Payment Link</label>
                  {/* type="text", not "url" — browsers reject a bare domain (no https://)
                      under native url validation, but that's exactly what the server's
                      normalizePaymentLink() is meant to accept and fix up. */}
                  <input type="text" value={sfForm.paymentLink} onChange={sfSet('paymentLink')} placeholder="e.g. https://payment-gateway.com/pay/..." />
                </div>
              </div>

              {sfError && <div className={s.formError}>{sfError}</div>}

              <div className={s.modalFooter}>
                <button type="button" className={s.cancelBtn} onClick={closeSFModal}>Cancel</button>
                <button type="submit" className={s.saveBtn} disabled={sfSaving}>
                  {sfSaving ? 'Saving…' : sfModal === 'add' ? 'Create Event' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ Galore Umbrella Add Modal ══ */}
      {galoreModal && (
        <div className={s.overlay} onClick={closeGaloreModal}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <div>
                <div className={s.modalTag}>{galoreEditing ? 'Edit Galore Event' : 'New Galore Event'}</div>
                <h2 className={s.modalTitle}>{galoreEditing ? 'Edit Event Details' : 'Add Galore Event'}</h2>
              </div>
              <button className={s.closeBtn} onClick={closeGaloreModal}>✕</button>
            </div>

            <form onSubmit={handleSaveGalore} className={s.form}>
              <div className={s.imgSection}>
                <div className={s.imgBox} onClick={() => galoreFileRef.current.click()}>
                  {galoreImgPrev
                    ? <img src={galoreImgPrev} alt="preview" className={s.imgPreview} />
                    : <div className={s.imgPlaceholder}><span>Click to upload banner</span></div>
                  }
                </div>
                <input ref={galoreFileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleGaloreFile} />
                <div className={s.imgHint}>JPG, PNG, WEBP · max 10 MB · Recommended: 16:9</div>
              </div>

              <div className={s.field}>
                <label>Event Title <span className={s.req}>*</span></label>
                <input value={galoreForm.title} onChange={galoreSet('title')} placeholder="e.g. Galore 2027 — Annual Mega Fest" required />
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Status</label>
                  <select value={galoreForm.status} onChange={galoreSet('status')}>
                    {STATUS.map(st => <option key={st} value={st}>{st.charAt(0).toUpperCase() + st.slice(1)}</option>)}
                  </select>
                </div>
                <div className={s.field}>
                  <label>Start Date</label>
                  <input type="date" value={galoreForm.startDate} onChange={galoreSet('startDate')} />
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Display Date</label>
                  <input value={galoreForm.date} onChange={galoreSet('date')} placeholder="e.g. Feb 2–8, 2027" />
                </div>
                <div className={s.field}>
                  <label>Time</label>
                  <input value={galoreForm.time} onChange={galoreSet('time')} placeholder="e.g. 9:00 AM onwards" />
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Venue</label>
                  <input value={galoreForm.venue} onChange={galoreSet('venue')} placeholder="e.g. RKU Main Campus" />
                </div>
                <div className={s.field}>
                  <label>Seats / Availability</label>
                  <input value={galoreForm.seats} onChange={galoreSet('seats')} placeholder="e.g. Open Registration" />
                </div>
              </div>

              <div className={s.field}>
                <label>Description</label>
                <textarea rows={3} value={galoreForm.description} onChange={galoreSet('description')} placeholder="Event description…" />
              </div>

              <div className={s.field}>
                <label>Highlight <span className={s.hint}>(past events)</span></label>
                <input value={galoreForm.highlight} onChange={galoreSet('highlight')} placeholder="e.g. Best Edition Yet — 1,200+ Students" />
              </div>

              {/* Galore is never a paid event — no fee fields here or on any activity.
                  Coordinator assignment only happens once, at creation — editing the
                  umbrella's own info later doesn't touch who's assigned to what. */}
              {!galoreEditing && (
                <div style={{ background:'#f9fafb', border:'1.5px solid #e5e7eb', borderRadius:10, padding:'14px 16px' }}>
                  <div style={{ fontSize:'.78rem', fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:4 }}>
                    Assign a Coordinator to Every Activity <span className={s.req}>*</span>
                  </div>
                  <p style={{ fontSize:'.76rem', color:'#9ca3af', margin:'0 0 12px' }}>
                    Every activity is pre-programmed — this event can't be created until each one has a coordinator.
                  </p>
                  {galoreCatalog.length === 0 ? (
                    <div style={{ fontSize:'.82rem', color:'#9ca3af' }}>Loading activities…</div>
                  ) : (
                    ['sports', 'cultural', 'academic'].map(cat => (
                      <div key={cat} style={{ marginBottom: 14 }}>
                        <div style={{ fontSize:'.72rem', fontWeight:700, color:'#635BFF', marginBottom:6, textTransform:'uppercase', letterSpacing:'.04em' }}>
                          {GALORE_CATEGORY_LABEL[cat]}
                        </div>
                        {galoreCatalog.filter(a => a.category === cat).map(act => (
                          <div key={act.key} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                            <span style={{ flex:'0 0 130px', fontSize:'.85rem', fontWeight:600 }}>{act.title}</span>
                            <select
                              style={{ flex:1, padding:'7px 10px', borderRadius:8, fontSize:'.83rem', border: galoreAssignments[act.key] ? '1.5px solid #e5e7eb' : '1.5px solid #fca5a5' }}
                              value={galoreAssignments[act.key] || ''}
                              onChange={setActivityCoordinator(act.key)}>
                              <option value="">Select coordinator…</option>
                              {galoreCoordinators.map(c => <option key={c.id} value={c.id}>{c.name} ({c.email})</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                  {unassignedActivities.length > 0 && (
                    <div style={{ fontSize:'.76rem', color:'#dc2626', marginTop:4 }}>
                      {unassignedActivities.length} activit{unassignedActivities.length === 1 ? 'y' : 'ies'} still need a coordinator.
                    </div>
                  )}
                </div>
              )}

              {galoreError && <div className={s.formError}>{galoreError}</div>}

              <div className={s.modalFooter}>
                <button type="button" className={s.cancelBtn} onClick={closeGaloreModal}>Cancel</button>
                <button type="submit" className={s.saveBtn} disabled={galoreSaving || (!galoreEditing && unassignedActivities.length > 0)}>
                  {galoreSaving ? 'Saving…' : galoreEditing ? 'Save Changes' : 'Create Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ Reject Modal ══ */}
      {rejectModal && (
        <div className={s.overlay} onClick={() => setRejectModal(null)}>
          <div className={s.confirmBox} onClick={e => e.stopPropagation()}
            style={{ maxWidth:440, textAlign:'left' }}>
            <h3 style={{ marginBottom:6 }}>Reject Event Request</h3>
            <p style={{ marginBottom:14, fontSize:'.85rem', color:'#6b7280' }}>
              Rejecting: <strong>{rejectModal.title}</strong>
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:5, marginBottom:18 }}>
              <label style={{ fontSize:'.8rem', fontWeight:600, color:'#374151' }}>
                Reason for rejection <span style={{ color:'#9ca3af', fontWeight:400 }}>(optional — visible to coordinator)</span>
              </label>
              <textarea rows={3} value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                placeholder="e.g. Scheduling conflict with another event…"
                style={{ padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:8,
                  fontSize:'.875rem', fontFamily:'inherit', resize:'vertical', outline:'none' }} />
            </div>
            <div className={s.confirmBtns}>
              <button className={s.cancelBtn} onClick={() => setRejectModal(null)}>Cancel</button>
              <button className={s.delConfirmBtn} onClick={handleReject} disabled={rejecting}
                style={{ background:'#dc2626' }}>
                {rejecting ? 'Rejecting…' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Registrations Panel ══ */}
      {regEvent && (
        <div className={s.overlay} onClick={() => setRegEvent(null)}>
          <div className={s.regsModal} onClick={e => e.stopPropagation()}>
            <div className={s.regsHeader}>
              <div>
                <div className={s.modalTag}>Event Registrations</div>
                <h2 className={s.modalTitle}>{regEvent.title}</h2>
                <p className={s.regsSub}>
                  {regsLoading ? 'Loading…' : `${regs.length} registration${regs.length !== 1 ? 's' : ''}`}
                  {!teamsLoading && ` · ${teams.length} team${teams.length !== 1 ? 's' : ''} registered`}
                </p>
              </div>
              <div className={s.regsHeaderRight}>
                <button className={s.csvBtn} onClick={exportCSV} disabled={!regs.length}>Export CSV</button>
                <button className={s.closeBtn} onClick={() => setRegEvent(null)}>✕</button>
              </div>
            </div>

            <div className={s.regsTabBar}>
              <button className={`${s.regsSubTab} ${regsTab === 'list' ? s.regsSubTabOn : ''}`} onClick={() => setRegsTab('list')}>
                Registrations ({regs.length})
              </button>
              <button className={`${s.regsSubTab} ${regsTab === 'teams' ? s.regsSubTabOn : ''}`} onClick={() => setRegsTab('teams')}>
                Teams ({teams.length})
              </button>
            </div>

            {regsTab === 'list' && (<>
            <div className={s.regsSearchWrap}>
              <input className={s.regsSearch}
                placeholder="Search by name, enrollment, department, or email…"
                value={regSearch} onChange={e => setRegSearch(e.target.value)} />
            </div>
            <div className={s.regsTableWrap}>
              {regsLoading ? (
                <div className={s.regsEmpty}>Loading registrations…</div>
              ) : regs.length === 0 ? (
                <div className={s.regsEmpty}><p>No registrations yet for this event.</p></div>
              ) : filteredRegs.length === 0 ? (
                <div className={s.regsEmpty}>No registrations match your search.</div>
              ) : (
                <table className={s.regsTable}>
                  <thead>
                    <tr>
                      <th>#</th><th>Name</th><th>Enrollment No.</th><th>Dept</th><th>Course</th><th>Gender</th><th>Mobile</th><th>Email</th>
                      {regQCols.map(c => (
                        /* Question text can be long — wrap it inside its own column
                           instead of the header row's usual nowrap spilling it over
                           the next column. */
                        <th key={c.id} title={c.label}
                          style={{ whiteSpace: 'normal', minWidth: 160, maxWidth: 240, overflowWrap: 'anywhere', lineHeight: 1.35, verticalAlign: 'bottom' }}>
                          {c.label}
                        </th>
                      ))}
                      <th>Registered At</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRegs.map((r, i) => {
                      const isEditing = editingRegId === String(r.id);
                      return (
                        <tr key={r.id || i}>
                          <td className={s.regsNum}>{i + 1}</td>
                          {isEditing ? (
                            <>
                              <td><input className={s.regsEditInput} value={regEditForm.name}
                                onChange={e => setRegEditForm(f => ({ ...f, name: e.target.value }))} /></td>
                              <td><input className={s.regsEditInput} value={regEditForm.enrollmentNo}
                                onChange={e => setRegEditForm(f => ({ ...f, enrollmentNo: e.target.value }))} /></td>
                              <td><input className={s.regsEditInput} value={regEditForm.dept}
                                onChange={e => setRegEditForm(f => ({ ...f, dept: e.target.value }))} /></td>
                              <td><input className={s.regsEditInput} value={regEditForm.course}
                                onChange={e => setRegEditForm(f => ({ ...f, course: e.target.value }))} /></td>
                              <td>
                                <select className={s.regsEditInput} value={regEditForm.gender}
                                  onChange={e => setRegEditForm(f => ({ ...f, gender: e.target.value }))}>
                                  <option value="">—</option>
                                  <option value="M">M</option>
                                  <option value="F">F</option>
                                </select>
                              </td>
                              <td><input className={s.regsEditInput} value={regEditForm.phone}
                                onChange={e => setRegEditForm(f => ({ ...f, phone: e.target.value }))} /></td>
                            </>
                          ) : (
                            <>
                              <td className={s.regsName}>{r.name || '—'}</td>
                              <td><span className={s.regsBadge}>{r.enrollment_no || '—'}</span></td>
                              <td><span className={s.regsDept}>{r.dept || '—'}</span></td>
                              <td>{r.course || '—'}</td>
                              <td>{r.gender || '—'}</td>
                              <td>{r.phone || '—'}</td>
                            </>
                          )}
                          <td className={s.regsEmail}>{displayEmail(r.email)}</td>
                          {regQCols.map(c => (
                            <td key={c.id} style={{ minWidth: 160, maxWidth: 240, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                              {answerOf(r, c.id) || '—'}
                            </td>
                          ))}
                          <td className={s.regsDate}>
                            {r.registered_at
                              ? new Date(r.registered_at).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
                              : '—'}
                          </td>
                          <td>
                            {isEditing ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className={s.csvBtn} disabled={regSaving} onClick={() => saveEditReg(r.id, regEvent._id)}>
                                  {regSaving ? 'Saving…' : 'Save'}
                                </button>
                                <button className={s.closeBtn} disabled={regSaving} onClick={cancelEditReg}>✕</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button className={s.csvBtn} onClick={() => startEditReg(r)}>Edit</button>
                                <button className={s.delBtn} onClick={() => { setDeleteRegId(String(r.id)); setDeleteRegEventId(regEvent._id); }}>Delete</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            </>)}

            {regsTab === 'teams' && (
              <div className={s.teamsPanel}>
                {teamsLoading ? (
                  <div className={s.regsEmpty}>Loading teams…</div>
                ) : DIVISIONS.map(division => {
                  const divTeams = teamsByDiv[division];
                  const unassigned = getUnassignedRegs();
                  return (
                    <div key={division} className={s.divisionSection}>
                      {regEvent?.category === 'sports' && (
                        <div className={s.divisionSectionTitle}>{DIVISION_LABEL[division]}</div>
                      )}

                      <div className={s.createTeamBar}>
                        <input
                          className={s.teamInput}
                          placeholder="Team name…"
                          value={newTeamName[division]}
                          onChange={e => setNewTeamName(p => ({ ...p, [division]: e.target.value }))}
                          onKeyDown={e => e.key === 'Enter' && handleCreateTeam(division)} />
                        <input
                          type="number" min="0"
                          className={s.teamSizeInput}
                          placeholder="Max (0=∞)"
                          value={newTeamSize[division]}
                          onChange={e => setNewTeamSize(p => ({ ...p, [division]: e.target.value }))} />
                        <button
                          className={s.createTeamBtn}
                          onClick={() => handleCreateTeam(division)}
                          disabled={!newTeamName[division].trim() || creatingTeam[division]}>
                          {creatingTeam[division] ? '…' : '+ Create Team'}
                        </button>
                      </div>

                      {divTeams.length === 0 ? (
                        <div className={s.regsEmpty}>
                          <p>No teams registered yet.</p>
                        </div>
                      ) : (
                        <div className={s.teamsList}>
                          {divTeams.map(team => {
                            const isExpanded = expandedTeams.has(team.id);
                            const isFull = team.maxSize > 0 && team.members.length >= team.maxSize;
                            return (
                              <div key={team.id} className={`${s.teamCard} ${team.isCleared ? s.teamCardCleared : ''}`}>
                                <div className={s.teamRow}>
                                  <button className={s.teamNameBtn} onClick={() => toggleTeamExpand(team)}>
                                    <span className={s.teamChevron}>{isExpanded ? '▼' : '▶'}</span>
                                    <span className={s.teamName}>{team.name}</span>
                                    {team.captainName && <span className={s.teamCaptain}>Captain: {team.captainName}</span>}
                                    <span className={s.teamCount}>
                                      {team.members.length}{team.maxSize > 0 ? `/${team.maxSize}` : ''} member{team.members.length !== 1 ? 's' : ''}
                                    </span>
                                    {isFull && <span className={s.teamFull}>Full</span>}
                                  </button>
                                  <button
                                    className={`${s.teamClearBox} ${team.isCleared ? s.teamClearBoxOn : ''}`}
                                    onClick={() => handleToggleClear(team.id)}
                                    title={team.isCleared ? 'Unmark cleared' : 'Mark team as cleared'}>
                                    {team.isCleared ? '✓' : ''}
                                  </button>
                                </div>

                                {isExpanded && (
                                  <div className={s.teamMembersWrap}>
                                    {team.members.length === 0 ? (
                                      <div className={s.teamNoMembers}>No members yet.</div>
                                    ) : (
                                      <div className={s.teamMembersList}>
                                        {team.members.map((m, idx) => (
                                          <div key={m.id} className={s.teamMemberRow}>
                                            <span className={s.memberNum}>{idx + 1}</span>
                                            <div className={s.memberInfo}>
                                              <span className={s.teamMemberName}>
                                                {m.name}{m.isCaptain && <span className={s.captainTag}>Captain</span>}
                                              </span>
                                              {(m.enrollmentNo || m.email || m.phone) && (
                                                <span className={s.teamMemberEnroll}>
                                                  {[m.enrollmentNo, m.email, m.phone].filter(Boolean).join(' · ')}
                                                </span>
                                              )}
                                            </div>
                                            <button className={s.removeMemberBtn} onClick={() => handleRemoveMember(team.id, m.id)} title="Remove from team">✕</button>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    {!isFull && (
                                      <select
                                        className={s.addMemberSelect}
                                        value=""
                                        onChange={e => { if (e.target.value) handleAddMember(team.id, e.target.value); }}>
                                        <option value="">
                                          {unassigned.length === 0 ? 'All participants assigned' : '+ Add participant to team…'}
                                        </option>
                                        {unassigned.map(r => (
                                          <option key={r.id} value={r.id}>{r.name}{r.enrollment_no ? ` — ${r.enrollment_no}` : ''}</option>
                                        ))}
                                      </select>
                                    )}
                                    {isFull && <div className={s.teamFullMsg}>Team is full ({team.maxSize}/{team.maxSize} members)</div>}

                                    <div className={s.teamEditSection}>
                                      <div className={s.teamEditRow}>
                                        <input
                                          className={s.teamEditInput}
                                          value={teamEdits[team.id]?.name ?? team.name}
                                          onChange={e => setTeamEdits(p => ({ ...p, [team.id]: { ...p[team.id], name: e.target.value } }))}
                                          placeholder="Team name…" />
                                        <input
                                          type="number" min="0"
                                          className={s.teamEditSizeInput}
                                          value={teamEdits[team.id]?.maxSize ?? String(team.maxSize)}
                                          onChange={e => setTeamEdits(p => ({ ...p, [team.id]: { ...p[team.id], maxSize: e.target.value } }))}
                                          placeholder="Max (0=∞)" />
                                        <button className={s.teamSaveBtn} onClick={() => handleUpdateTeam(team.id)}>Save</button>
                                      </div>
                                      <button className={s.teamDangerBtn} onClick={() => handleDeleteTeam(team.id)}>Delete Team</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ Delete confirm ══ */}
      {deleteId && (
        <div className={s.overlay} onClick={() => setDeleteId(null)}>
          <div className={s.confirmBox} onClick={e => e.stopPropagation()}>
            <h3>Delete this event?</h3>
            <p>It will be removed from the guest site immediately.</p>
            <div className={s.confirmBtns}>
              <button className={s.cancelBtn} onClick={() => setDeleteId(null)}>Cancel</button>
              <button className={s.delConfirmBtn} onClick={handleDelete}>Yes, Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Delete registration confirm ══ */}
      {deleteRegId && (
        <div className={s.overlay} onClick={() => setDeleteRegId(null)} style={{ zIndex: 10001 }}>
          <div className={s.confirmBox} onClick={e => e.stopPropagation()}>
            <h3>Delete this registration?</h3>
            <p>If they're on a team for this event, they'll be removed from it too. This can't be undone.</p>
            <div className={s.confirmBtns}>
              <button className={s.cancelBtn} disabled={regDeleting} onClick={() => setDeleteRegId(null)}>Cancel</button>
              <button className={s.delConfirmBtn} disabled={regDeleting} onClick={handleDeleteReg}>
                {regDeleting ? 'Deleting…' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
