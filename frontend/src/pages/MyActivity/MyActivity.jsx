import { useState } from 'react';
import api from '../../api/client';
import s from './MyActivity.module.css';
import ActivityResults from './ActivityResults';
import { fmt } from './activityUtils';

const CLUB_STATUS = {
  member:   { label: 'Accepted', cls: 'clubStatusMember'   },
  pending:  { label: 'Pending',  cls: 'clubStatusPending'  },
  declined: { label: 'Declined', cls: 'clubStatusDeclined' },
  inactive: { label: 'Inactive', cls: 'clubStatusInactive' },
};

export default function MyActivity() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [result, setResult]   = useState(null); // { participated, hasAccount, clubs, categories, attendanceSummary }

  const submit = (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!trimmed.toLowerCase().endsWith('@rku.ac.in')) {
      setError('Only @rku.ac.in emails are allowed.');
      return;
    }
    setError('');
    setLoading(true);
    api.get(`/users/activity-by-email?email=${encodeURIComponent(trimmed)}`)
      .then(setResult)
      .catch(err => setError(err.message || 'Something went wrong. Please try again.'))
      .finally(() => setLoading(false));
  };

  const reset = () => { setResult(null); setError(''); };

  const clubs = result?.clubs || [];

  return (
    <div className="wrap">
      <div className={s.hero}>
        <h1 className={s.heroTitle}>My Activity</h1>
        <p className={s.heroSub}>
          Enter email to check your club status and see everything you've participated in —
          sports, cultural, social and academic.
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

          {clubs.length > 0 && (
            <div className={s.clubSection}>
              <div className={`${s.actSectionTitle} ${s.clubSectionHead}`}>
                <span>Clubs</span>
                <span>Status</span>
              </div>
              {clubs.map(c => {
                const st = CLUB_STATUS[c.status] || CLUB_STATUS.pending;
                return (
                  <div key={c.clubId} className={s.clubRow}>
                    <div className={s.clubInfo}>
                      <span className={s.clubName}>{c.clubName}</span>
                      {c.requestedAt && (
                        <span className={s.clubDate}>
                          {c.status === 'member' || c.status === 'inactive' ? 'Since' : 'Requested'} {fmt(c.requestedAt)}
                        </span>
                      )}
                    </div>
                    <span className={`${s.clubStatus} ${s[st.cls]}`}>{st.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          <ActivityResults
            result={result}
            emptyMessage={clubs.length > 0
              ? 'You have not participated in any events yet.'
              : 'You have not participated in any events. Join a club of your interest to participate.'}
            emptyTo="/clubs"
            emptyCta="Explore Clubs"
          />
        </div>
      )}
    </div>
  );
}
