import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import s from './MyActivity.module.css';

const TABS = [
  { key: 'sports',   label: 'Sports'   },
  { key: 'cultural',  label: 'Cultural' },
  { key: 'social',    label: 'Social'   },
  { key: 'academic',  label: 'Academic' },
];

const fmt = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

function EventRow({ ev, open, onToggle }) {
  return (
    <div className={s.actAccItem}>
      <button className={s.actAccHeader} onClick={onToggle}>
        <div className={s.actAccLeft}>
          <span className={s.actAccName}>{ev.eventTitle}</span>
          <span className={s.actAccSub}>{ev.clubName}{ev.category ? ` · ${ev.category}` : ''}</span>
        </div>
        <div className={s.actAccRight}>
          {ev.contributionCoins > 0
            ? <span className={s.actCoinBadge}>+{ev.contributionCoins} coins</span>
            : <span className={s.actCoinPending}>registered</span>}
          <span className={s.actAccChevron}>{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className={s.actAccBody}>
          <div className={s.actAccGrid}>
            <div className={s.actAccField}><span className={s.actAccLabel}>Club</span><span>{ev.clubName}</span></div>
            {ev.venue && <div className={s.actAccField}><span className={s.actAccLabel}>Venue</span><span>{ev.venue}</span></div>}
            {ev.eventDate && <div className={s.actAccField}><span className={s.actAccLabel}>Event Date</span><span>{fmt(ev.eventDate)}</span></div>}
            <div className={s.actAccField}><span className={s.actAccLabel}>Registered</span><span>{fmt(ev.registeredAt)}</span></div>
          </div>

          {ev.attendance && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>Attendance</span>
                <span style={{ fontSize: '.8rem', fontWeight: 700, color: '#D32F2F' }}>
                  {ev.attendance.percentage}% <span style={{ fontWeight: 400, color: '#9ca3af' }}>({ev.attendance.presentSessions}/{ev.attendance.totalSessions} days)</span>
                </span>
              </div>
              <div className={s.weeklyProgressBar}>
                <div className={s.weeklyProgressFill} style={{ width: `${ev.attendance.percentage}%` }} />
              </div>
            </div>
          )}

          {ev.achievements?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {ev.achievements.map((a, i) => (
                a.fileUrl
                  ? <a key={i} className={s.achBadge} href={a.fileUrl} target="_blank" rel="noreferrer">🏅 {a.category || 'Certificate'}</a>
                  : <span key={i} className={s.achBadge}>🏅 {a.category || 'Certificate'} (pending)</span>
              ))}
            </div>
          )}

          <div className={s.actAccCoins}>
            {ev.contributionCoins > 0 ? (
              <div className={s.actAccCoinRow}>
                <span>Total contribution</span>
                <span className={s.actCoinBadge}>+{ev.contributionCoins} coins</span>
              </div>
            ) : (
              <div className={s.actAccCoinRow}>
                <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No coins recorded for this event yet</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MyActivity() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [result, setResult]   = useState(null); // { participated, hasAccount, categories }
  const [activeTab, setActiveTab] = useState('sports');
  const [openIdx, setOpenIdx] = useState(null);

  const submit = (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    setError('');
    setLoading(true);
    api.get(`/users/activity-by-email?email=${encodeURIComponent(trimmed)}`)
      .then(r => {
        setResult(r);
        setActiveTab(r.categories?.find(c => c.events.length > 0)?.key || 'sports');
        setOpenIdx(null);
      })
      .catch(err => setError(err.message || 'Something went wrong. Please try again.'))
      .finally(() => setLoading(false));
  };

  const reset = () => { setResult(null); setError(''); };

  const activeCategory = result?.categories?.find(c => c.key === activeTab);

  return (
    <div className="wrap">
      <div className={s.hero}>
        <h1 className={s.heroTitle}>My Activity</h1>
        <p className={s.heroSub}>
          Not part of a club? Enter the email you used to register for events to see everything
          you've participated in — sports, cultural, social and academic — in one place.
        </p>
      </div>

      {!result && (
        <form className={s.formCard} onSubmit={submit}>
          <label className={s.formLabel} htmlFor="myActivityEmail">Your email address</label>
          <input
            id="myActivityEmail"
            className={s.formInput}
            type="email"
            placeholder="you@rku.ac.in"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoFocus
          />
          {error && <div className={s.formError}>{error}</div>}
          <button className={s.formBtn} type="submit" disabled={loading}>
            {loading ? 'Checking…' : 'View My Activity'}
          </button>
        </form>
      )}

      {result && (
        <div className={s.resultWrap}>
          <button className={s.changeEmailBtn} onClick={reset}>← Check a different email</button>

          {!result.participated ? (
            <div className={s.emptyCard}>
              <div className={s.emptyIcon}>🙌</div>
              <p className={s.emptyMsg}>You have not participated in any events. Join a club of your interest to participate.</p>
              <Link className={s.emptyCta} to="/clubs">Explore Clubs</Link>
            </div>
          ) : (
            <>
              <div className={s.tabBar}>
                {TABS.map(t => {
                  const cat = result.categories.find(c => c.key === t.key);
                  const count = cat?.events.length || 0;
                  return (
                    <button
                      key={t.key}
                      className={`${s.tabBtn} ${activeTab === t.key ? s.tabBtnOn : ''}`}
                      onClick={() => { setActiveTab(t.key); setOpenIdx(null); }}
                    >
                      {t.label}<span className={s.tabCount}>{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className={s.actSectionTitle}>{activeCategory?.label} Activity</div>
              {activeCategory?.events.length > 0 ? (
                activeCategory.events.map((ev, i) => (
                  <EventRow key={ev.eventId + '-' + i} ev={ev} open={openIdx === i} onToggle={() => setOpenIdx(openIdx === i ? null : i)} />
                ))
              ) : (
                <p className={s.actEmpty}>No {activeCategory?.label.toLowerCase()} activity yet.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
