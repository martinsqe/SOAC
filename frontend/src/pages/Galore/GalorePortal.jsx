import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { galoreApi, galoreToken } from '../../utils/galoreApi';
import GaloreLetterhead from '../../components/GaloreLetterhead/GaloreLetterhead';
import GaloreHead from './GaloreHead';
import GaloreStaff from './GaloreStaff';
import GaloreStudent from './GaloreStudent';
import { Empty } from './GaloreUI';
import { headPages, staffPages, studentPages, commonPages } from './galoreHelpers';
import { GaloreCoordinatorsPage, GaloreAboutPage, GaloreGalleryPage } from './GaloreCommon';
import { SotyStudentPage, SotyHeadPage } from './GaloreSoty';
import s from './Galore.module.css';

/* Galore portal — one login (one email, one account), a separate dashboard for
   each Galore role that email has, all on the Galore letterhead (logos on
   white, grey nav strip, registration deadline):
     Main coordinator        the overall Galore coordinator (GaloreHead)
     Department coordinator  their department(s)            (GaloreStaff)
     Activity coordinator    their activities               (GaloreStaff)
     Student                 their registrations            (GaloreStudent)
   Each dashboard has its own strip of pages: About Galore first, then the
   role's own pages, then Coordinators · Gallery · Log out. Someone with more
   than one role gets the dashboard's name with a dropdown arrow to switch
   (like the club switcher in club accounts); with one role it never shows.
   Logged in with the Galore account, not the SOAC club account. */
const ROLE_KEY = 'galore_dashboard'; // last dashboard picked, per browser
const readRole = () => { try { return localStorage.getItem(ROLE_KEY) || ''; } catch { return ''; } };
const saveRole = (k) => { try { localStorage.setItem(ROLE_KEY, k); } catch { /* storage blocked */ } };
export default function GalorePortal() {
  const navigate = useNavigate();
  const [data,     setData]     = useState(null);
  const [error,    setError]    = useState('');
  const [tab,      setTab]      = useState(readRole);
  const [page,     setPage]     = useState('');
  const [deadline, setDeadline] = useState('');
  const [soty,     setSoty]     = useState(null);  // Student of the Year, once published (has its own last date)
  const sotyOn = !!soty;
  const [pwOpen,   setPwOpen]   = useState(false); // "Change password" card open
  const pwRef = useRef(null);
  /* the button is at the bottom of the page and the card at the top — bring it into view */
  useEffect(() => { if (pwOpen) pwRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [pwOpen]);

  const logout = useCallback(() => { galoreToken.clear(); navigate('/galore/login', { replace: true }); }, [navigate]);

  const load = useCallback(() => {
    galoreApi.get('/me')
      .then(setData)
      .catch(err => { if (err.status === 401) logout(); else setError(err.message); });
  }, [logout]);

  useEffect(() => {
    if (!galoreToken.get()) { navigate('/galore/login', { replace: true }); return; }
    load();
  }, [load, navigate]);

  /* One dashboard per role this email has. A department and an activity
     assignment are separate dashboards, each showing only its own side. */
  const deptStaff = data ? data.staff.filter(x => x.departments.length > 0).map(x => ({ ...x, activities: [] })) : [];
  const actStaff  = data ? data.staff.filter(x => x.activities.length > 0).map(x => ({ ...x, departments: [] })) : [];
  const roles = data ? [
    data.head?.length > 0   && ['head',     'Main coordinator',       headPages(sotyOn)],
    deptStaff.length > 0    && ['dept',     'Department coordinator', staffPages(deptStaff)],
    actStaff.length > 0     && ['activity', 'Activity coordinator',   staffPages(actStaff)],
    data.student.length > 0 && ['student',  'Student',                studentPages(data.student, sotyOn)],
  ].filter(Boolean) : [];
  const current = roles.find(([k]) => k === tab) || roles[0];
  /* About Galore first, the role's own pages, then the rest every role has */
  /* …and Student of the Year last, just before Log out */
  const own = current ? current[2].filter(([k]) => k !== 'soty') : [];
  const sotyPage = current ? current[2].filter(([k]) => k === 'soty') : [];
  const pages = current ? [['about', 'About Galore'], ...own, ...commonPages().filter(([k]) => k !== 'about'), ...sotyPage] : [];
  const currentPage = pages.some(([k]) => k === page) ? page : pages[0]?.[0];
  const isCommon = commonPages().some(([k]) => k === currentPage);
  const isSoty = currentPage === 'soty';
  const nav = pages.length ? [...pages, ['logout', 'Log out', logout]] : [];

  /* The Galore event — for the shared pages and the "last date of registration"
     line the admin sets on it */
  const event = data && (data.head?.[0]?.event || data.staff[0]?.event || data.student[0]?.event);
  const eventId = event?.id;
  useEffect(() => {
    if (!eventId) return;
    api.get(`/events/${eventId}/galore-deadline`).then(d => setDeadline(d.deadline || '')).catch(() => setDeadline(''));
    /* Student of the Year joins the student's and the main coordinator's strip once published */
    galoreApi.get(`/events/${eventId}/soty`).then(d => setSoty(d.contest || null)).catch(() => setSoty(null));
  }, [eventId]);

  const ready = data && !data.account.mustChangePassword;
  /* The overall coordinator, on their own dashboard: edits About Galore, adds to the gallery */
  const isHeadHere = current?.[0] === 'head' && !!data?.head?.some(x => x.event.id === event?.id);
  const switchRole = (k) => { setTab(k); setPage(''); saveRole(k); };

  return (
    <div className={s.portalPage}>
      <div className={s.portalWrap}>
        <GaloreLetterhead
          plain
          nav={ready && roles.length ? nav : undefined}
          active={currentPage}
          onNav={setPage}
          deadline={!ready ? '' : isSoty ? (soty?.opened ? soty.deadline || '' : '') : deadline}
        >
          {error && <div className={s.error}>{error}</div>}
          {!data && !error && <div className={s.muted}>Loading…</div>}

          {data && data.account.mustChangePassword && <ChangePassword onDone={load} />}

          {ready && (
            <>
              {pwOpen && (
                <div ref={pwRef} style={{ marginBottom: 18 }}>
                  <ChangePassword onDone={() => { setPwOpen(false); load(); }} onCancel={() => setPwOpen(false)} />
                </div>
              )}

              {roles.length > 1 && (
                <RoleSwitch roles={roles} current={current[0]} onPick={switchRole} />
              )}

              {roles.length === 0 && (
                <div className={s.card}><Empty>Nothing here yet — no Galore registrations or assignments for {data.account.email}.</Empty></div>
              )}

              {isCommon && event && (
                currentPage === 'coordinators' ? <GaloreCoordinatorsPage event={event} />
                  : currentPage === 'about' ? <GaloreAboutPage event={event} canEdit={isHeadHere} onSaved={load} />
                  : <GaloreGalleryPage key={`${event.id}-${isHeadHere}`} event={event} canAdd={isHeadHere} />
              )}

              {isSoty && event && current?.[0] === 'head' && <SotyHeadPage eventId={event.id} onContest={c => setSoty(x => (x ? { ...x, ...c } : x))} />}
              {isSoty && event && current?.[0] === 'student' && <SotyStudentPage eventId={event.id} />}

              {!isCommon && !isSoty && current?.[0] === 'head' && data.head.map(x => <GaloreHead key={x.event.id} eventId={x.event.id} section={currentPage} />)}
              {!isCommon && !isSoty && current?.[0] === 'dept' && deptStaff.map(x => <GaloreStaff key={`d${x.event.id}`} data={x} section={currentPage} />)}
              {!isCommon && !isSoty && current?.[0] === 'activity' && actStaff.map(x => <GaloreStaff key={`a${x.event.id}`} data={x} section={currentPage} />)}
              {!isCommon && !isSoty && current?.[0] === 'student' && data.student.map(x => <GaloreStudent key={x.event.id} data={x} section={currentPage} />)}
            </>
          )}
        </GaloreLetterhead>
      </div>

      {/* Bottom corners: Change password on the left; name + Log out on the right */}
      <div className={s.portalBar}>
        <div className={s.portalBarSide}>
          {ready && (
            <button className={s.backBtn} aria-expanded={pwOpen} onClick={() => setPwOpen(o => !o)}>Change password</button>
          )}
        </div>
        <div className={`${s.portalBarSide} ${s.portalBarRight}`}>
          {data && <span className={s.userName} title={data.account.email}>{data.account.name || data.account.email}</span>}
          <button className={s.backBtn} onClick={logout}>Log out</button>
        </div>
      </div>
    </div>
  );
}

/* ── Switch dashboard: the current dashboard's name + an arrow, plain on the
   white; opens a small menu of the other dashboards this email has ── */
function RoleSwitch({ roles, current, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const label = roles.find(([k]) => k === current)?.[1];
  return (
    <div className={s.roleSwitch} ref={ref}>
      <button type="button" className={s.roleWord} aria-haspopup="menu" aria-expanded={open}
        title="Switch dashboard" onClick={() => setOpen(o => !o)}>
        {label}
        <svg className={`${s.roleArrow} ${open ? s.roleArrowUp : ''}`} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className={s.roleMenu} role="menu">
          {roles.map(([k, l]) => (
            <button key={k} type="button" role="menuitemradio" aria-checked={k === current}
              className={`${s.roleItem} ${k === current ? s.roleItemOn : ''}`}
              onClick={() => { setOpen(false); if (k !== current) onPick(k); }}>
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── First login: choose your own password ── */
function ChangePassword({ onDone, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next,    setNext]    = useState('');
  const [again,   setAgain]   = useState('');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 8) return setError('Choose a password of at least 8 characters.');
    if (next !== again) return setError("The new passwords don't match.");
    setBusy(true); setError('');
    try { await galoreApi.post('/change-password', { current, next }); onDone(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div className={`${s.card} ${s.loginBox}`} style={{ marginTop: onCancel ? 0 : '4vh' }}>
      <h2 className={s.cardTitle}>{onCancel ? 'Change password' : 'Choose your password'}</h2>
      <p className={s.muted} style={{ margin: '0 0 16px' }}>
        {onCancel ? 'Enter your current password and a new one.' : 'Replace the temporary password from your email with one of your own.'}
      </p>
      {error && <div className={s.error}>{error}</div>}
      <form onSubmit={submit}>
        <div className={s.field}><label>{onCancel ? 'Current password' : 'Temporary password (from the email)'}</label>
          <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} /></div>
        <div className={s.field}><label>New password</label>
          <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} /></div>
        <div className={s.field}><label>New password again</label>
          <input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className={s.primaryBtn} style={{ flex: 1 }} disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
          {onCancel && <button type="button" className={s.smallBtn} onClick={onCancel}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}
