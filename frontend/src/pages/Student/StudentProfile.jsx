import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import s from './StudentProfile.module.css';

const AVATAR_BASE = '/uploads/avatars/';

function getAvatarUrl(avatar) {
  if (!avatar) return null;
  if (avatar.startsWith('http')) return avatar;
  return AVATAR_BASE + avatar;
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function getHue(name) {
  if (!name) return 200;
  return name.charCodeAt(0) * 5 % 360;
}

function pwStrengthCalc(pw) {
  if (!pw) return null;
  let score = 0;
  if (pw.length >= 8)          score++;
  if (pw.length >= 12)         score++;
  if (/[A-Z]/.test(pw))        score++;
  if (/[0-9]/.test(pw))        score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { label: 'Weak',   color: '#ef4444', pct: 20  };
  if (score <= 2) return { label: 'Fair',   color: '#f59e0b', pct: 50  };
  if (score <= 3) return { label: 'Good',   color: '#3b82f6', pct: 75  };
  return               { label: 'Strong', color: '#22c55e', pct: 100 };
}

/* ─── Small reusable section card ─── */
function SectionCard({ icon, title, subtitle, children }) {
  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <span className={s.cardIcon}>{icon}</span>
        <div>
          <div className={s.cardTitle}>{title}</div>
          {subtitle && <div className={s.cardSub}>{subtitle}</div>}
        </div>
      </div>
      <div className={s.cardBody}>{children}</div>
    </div>
  );
}

/* ─── Field ─── */
function Field({ label, hint, children }) {
  return (
    <div className={s.field}>
      <label className={s.label}>{label}</label>
      {children}
      {hint && <span className={s.hint}>{hint}</span>}
    </div>
  );
}

export default function StudentProfile() {
  const { user, updateUser, refreshUser } = useAuth();

  /* ── avatar / name ── */
  const [name,          setName]          = useState(user?.name || '');
  const [avatarFile,    setAvatarFile]    = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg,    setProfileMsg]    = useState('');
  const [profileOk,     setProfileOk]    = useState(false);
  const fileRef = useRef(null);

  /* ── password ── */
  const [currentPw,   setCurrentPw]   = useState('');
  const [newPw,       setNewPw]       = useState('');
  const [confirmPw,   setConfirmPw]   = useState('');
  const [showCur,     setShowCur]     = useState(false);
  const [showNew,     setShowNew]     = useState(false);
  const [showConf,    setShowConf]    = useState(false);
  const [pwSaving,    setPwSaving]    = useState(false);
  const [pwMsg,       setPwMsg]       = useState('');
  const [pwOk,        setPwOk]        = useState(false);

  /* ── SOAC Coins ── */
  const [coins,       setCoins]       = useState(null);
  const [coinsLoaded, setCoinsLoaded] = useState(false);

  /* ── clubs joined (for profile card) ── */
  const [myClubs, setMyClubs] = useState([]);

  /* ── Weekly evaluation ── */
  const [weeklyData,    setWeeklyData]    = useState(null);
  const [weeklyLoading, setWeeklyLoading] = useState(true);

  useEffect(() => {
    api.get('/users/me/clubs').then(r => setMyClubs(r.clubs || [])).catch(() => {});
    setCoins(user?.coins ?? 0);
    setCoinsLoaded(true);
    api.get('/users/me/weekly-evaluation')
      .then(r => setWeeklyData(r))
      .catch(() => setWeeklyData(null))
      .finally(() => setWeeklyLoading(false));
  }, [user]);

  const markNotifRead = async (id) => {
    try {
      await api.patch(`/users/me/notifications/${id}/read`, {});
      setWeeklyData(prev => prev ? {
        ...prev,
        notifications: prev.notifications.map(n => n.id === id ? { ...n, isRead: true } : n),
      } : prev);
    } catch { /* silent */ }
  };

  const displayUrl = avatarPreview || getAvatarUrl(user?.avatar);
  const hue        = getHue(user?.name);
  const strength   = pwStrengthCalc(newPw);

  /* ── Handlers ── */
  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setProfileMsg('');
  };

  const handleProfileSave = async () => {
    const nameChanged   = name.trim() && name.trim() !== user?.name;
    const avatarChanged = !!avatarFile;
    if (!nameChanged && !avatarChanged) {
      setProfileMsg('No changes to save.');
      setProfileOk(false);
      return;
    }
    setProfileSaving(true);
    setProfileMsg('');
    try {
      const fd = new FormData();
      if (nameChanged)   fd.append('name', name.trim());
      if (avatarChanged) fd.append('avatar', avatarFile);
      const { user: updated } = await api.putForm('/users/me/profile', fd);
      updateUser(updated);
      setAvatarFile(null);
      setProfileMsg('✓ Profile updated successfully!');
      setProfileOk(true);
    } catch (err) {
      setProfileMsg(err.message || 'Update failed.');
      setProfileOk(false);
    } finally {
      setProfileSaving(false);
    }
  };

  const handlePasswordSave = async () => {
    if (!currentPw || !newPw || !confirmPw) {
      setPwMsg('All fields are required.');   setPwOk(false); return;
    }
    if (newPw.length < 8) {
      setPwMsg('New password must be at least 8 characters.'); setPwOk(false); return;
    }
    if (newPw !== confirmPw) {
      setPwMsg('Passwords do not match.'); setPwOk(false); return;
    }
    setPwSaving(true); setPwMsg('');
    try {
      await api.post('/auth/change-password', { currentPassword: currentPw, newPassword: newPw });
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
      setPwMsg('✓ Password changed successfully!');
      setPwOk(true);
      refreshUser();
    } catch (err) {
      setPwMsg(err.message || 'Failed to change password.'); setPwOk(false);
    } finally {
      setPwSaving(false);
    }
  };

  /* ── Eye toggle button ── */
  const Eye = ({ show, onToggle }) => (
    <button type="button" className={s.eyeBtn} onClick={onToggle} tabIndex={-1}>
      {show
        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      }
    </button>
  );

  return (
    <div className={s.page}>

      {/* ── Page header ── */}
      <div className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Profile & Settings</h1>
          <p className={s.pageSub}>Manage your account, security and SOAC wallet</p>
        </div>
      </div>

      <div className={s.layout}>

        {/* ════════ LEFT — identity card ════════ */}
        <aside className={s.sidebar}>

          {/* Avatar card */}
          <div className={s.identityCard}>
            <div className={s.avatarWrap}>
              {displayUrl
                ? <img src={displayUrl} alt={user?.name} className={s.avatarImg}
                    onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                : null
              }
              <div className={s.avatarFb}
                style={{ background: `hsl(${hue},60%,52%)`, display: displayUrl ? 'none' : 'flex' }}>
                {getInitials(user?.name)}
              </div>
              <button className={s.avatarEditBtn} onClick={() => fileRef.current?.click()} title="Change photo">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display:'none' }} onChange={handleAvatarChange} />
            </div>

            <div className={s.idName}>{user?.name}</div>
            <div className={s.idEmail}>{user?.email}</div>
            <span className={s.idBadge}>🎓 Student</span>

            <div className={s.idStats}>
              <div className={s.idStat}>
                <div className={s.idStatN}>{myClubs.length}</div>
                <div className={s.idStatL}>Clubs</div>
              </div>
              <div className={s.idStatDiv} />
              <div className={s.idStat}>
                <div className={s.idStatN} style={{ color: '#f59e0b' }}>
                  {coinsLoaded ? coins : '—'}
                </div>
                <div className={s.idStatL}>Coins</div>
              </div>
              <div className={s.idStatDiv} />
              <div className={s.idStat}>
                <div className={s.idStatN}>{3 - myClubs.length}</div>
                <div className={s.idStatL}>Slots left</div>
              </div>
            </div>
          </div>

          {/* SOAC Coins wallet card */}
          <div className={s.coinsCard}>
            <div className={s.coinsTop}>
              <span className={s.coinsIcon}>🪙</span>
              <div>
                <div className={s.coinsLabel}>SOAC Coins</div>
                <div className={s.coinsHint}>Your campus reward wallet</div>
              </div>
            </div>
            <div className={s.coinsBal}>
              {coinsLoaded ? coins : <span className={s.coinsSkel} />}
              <span className={s.coinsUnit}>coins</span>
            </div>
            <div className={s.coinsInfo}>
              <div className={s.coinsTip}>
                <span>🎁</span>
                <span>Earn coins by attending events &amp; activities</span>
              </div>
              <div className={s.coinsTip}>
                <span>🛒</span>
                <span>Redeem for fee waivers &amp; merchandise</span>
              </div>
              <div className={s.coinsTip}>
                <span>📈</span>
                <span>Transaction history coming soon</span>
              </div>
            </div>
          </div>

          {/* Quick info */}
          <div className={s.infoCard}>
            <div className={s.infoRow}><span className={s.infoLbl}>University</span><span className={s.infoVal}>RK University</span></div>
            <div className={s.infoRow}><span className={s.infoLbl}>Portal</span><span className={s.infoVal}>SOAC Student</span></div>
            <div className={s.infoRow}><span className={s.infoLbl}>Max clubs</span><span className={s.infoVal}>3 per semester</span></div>
          </div>

        </aside>

        {/* ════════ RIGHT — settings panels ════════ */}
        <div className={s.main}>

          {/* ── Profile info ── */}
          <SectionCard icon="👤" title="Personal Information" subtitle="Update your display name and profile photo">
            {avatarFile && (
              <div className={s.photoHint}>
                📷 New photo selected — save to apply
              </div>
            )}
            <div className={s.formRow}>
              <Field label="Display Name">
                <input
                  className={s.input}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your full name"
                  maxLength={80}
                />
              </Field>
              <Field label="Email Address" hint="Email cannot be changed — contact admin if needed.">
                <input className={`${s.input} ${s.inputDisabled}`} value={user?.email || ''} disabled />
              </Field>
            </div>
            <div className={s.formRow}>
              <Field label="Role">
                <input className={`${s.input} ${s.inputDisabled}`} value="Student" disabled />
              </Field>
              <Field label="Enrollment No.">
                <input className={`${s.input} ${s.inputDisabled}`} value={user?.enrollmentNo || 'Not set'} disabled />
              </Field>
            </div>
            {profileMsg && (
              <div className={profileOk ? s.msgOk : s.msgErr}>{profileMsg}</div>
            )}
            <div className={s.formActions}>
              <button className={s.btnPrimary} onClick={handleProfileSave} disabled={profileSaving}>
                {profileSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </SectionCard>

          {/* ── Change Password ── */}
          <SectionCard icon="🔐" title="Change Password" subtitle="Use a strong password of at least 8 characters">
            <div className={s.formRow}>
              <Field label="Current Password">
                <div className={s.pwWrap}>
                  <input
                    className={s.input}
                    type={showCur ? 'text' : 'password'}
                    value={currentPw}
                    onChange={e => setCurrentPw(e.target.value)}
                    placeholder="Enter current password"
                  />
                  <Eye show={showCur} onToggle={() => setShowCur(v => !v)} />
                </div>
              </Field>
            </div>
            <div className={s.formRow}>
              <Field label="New Password">
                <div className={s.pwWrap}>
                  <input
                    className={s.input}
                    type={showNew ? 'text' : 'password'}
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    placeholder="Minimum 8 characters"
                  />
                  <Eye show={showNew} onToggle={() => setShowNew(v => !v)} />
                </div>
                {strength && (
                  <div className={s.strengthRow}>
                    <div className={s.strengthTrack}>
                      <div className={s.strengthFill} style={{ width: strength.pct + '%', background: strength.color }} />
                    </div>
                    <span style={{ color: strength.color, fontSize: 11, fontWeight: 700 }}>{strength.label}</span>
                  </div>
                )}
              </Field>
              <Field label="Confirm New Password">
                <div className={s.pwWrap}>
                  <input
                    className={s.input}
                    type={showConf ? 'text' : 'password'}
                    value={confirmPw}
                    onChange={e => setConfirmPw(e.target.value)}
                    placeholder="Re-enter new password"
                  />
                  <Eye show={showConf} onToggle={() => setShowConf(v => !v)} />
                </div>
                {confirmPw && newPw !== confirmPw && (
                  <span className={s.hint} style={{ color: '#ef4444' }}>Passwords do not match.</span>
                )}
                {confirmPw && newPw === confirmPw && confirmPw.length > 0 && (
                  <span className={s.hint} style={{ color: '#22c55e' }}>✓ Passwords match.</span>
                )}
              </Field>
            </div>
            {pwMsg && <div className={pwOk ? s.msgOk : s.msgErr}>{pwMsg}</div>}
            <div className={s.formActions}>
              <button className={s.btnPrimary} onClick={handlePasswordSave} disabled={pwSaving}>
                {pwSaving ? 'Changing…' : 'Change Password'}
              </button>
            </div>
          </SectionCard>

          {/* ── Weekly Evaluation ── */}
          <SectionCard icon="📅" title="Weekly Evaluation"
            subtitle={weeklyData
              ? `${new Date(weeklyData.weekStart).toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – ${new Date(weeklyData.weekEnd).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`
              : 'This week\'s attendance across your clubs'}>
            {weeklyLoading ? (
              <div className={s.weeklyLoading}>Loading your weekly summary…</div>
            ) : !weeklyData || weeklyData.clubs.length === 0 ? (
              <div className={s.weeklyEmpty}>You are not a member of any club yet. Join a club to see your weekly evaluation here.</div>
            ) : (
              <div className={s.weeklyClubs}>
                {weeklyData.clubs.map(cl => (
                  <div key={cl.clubId} className={s.weeklyClub}>
                    <div className={s.weeklyClubHead}>
                      <span className={s.weeklyClubDot} style={{ background: cl.color }} />
                      <span className={s.weeklyClubName}>{cl.clubName}</span>
                      {cl.consistencyBonus && (
                        <span className={s.weeklyBonusBadge}>Consistency Champion +100</span>
                      )}
                    </div>
                    <div className={s.weeklyStats}>
                      <div className={s.weeklyStat}>
                        <span className={s.weeklyStatVal}>{cl.weekPresent}</span>
                        <span className={s.weeklyStatLbl}>Days Present</span>
                      </div>
                      <div className={s.weeklyStat}>
                        <span className={s.weeklyStatVal}>{cl.weekXp}</span>
                        <span className={s.weeklyStatLbl}>XP Earned</span>
                      </div>
                      <div className={s.weeklyStat}>
                        {cl.consistencyBonus
                          ? <span className={s.weeklyStatVal} style={{color:'#059669'}}>Achieved</span>
                          : <span className={s.weeklyStatVal}>{cl.daysToBonus}</span>}
                        <span className={s.weeklyStatLbl}>{cl.consistencyBonus ? 'Bonus' : 'Days to Bonus'}</span>
                      </div>
                    </div>
                    {cl.sessions.length === 0 ? (
                      <div className={s.weeklyNoSessions}>No sessions recorded this week.</div>
                    ) : (
                      <div className={s.weeklySessions}>
                        {cl.sessions.map((sess, i) => (
                          <div key={i} className={s.weeklySession}>
                            <span className={`${s.weeklyStatusDot} ${s['weeklyStatus_' + sess.status]}`} />
                            <span className={s.weeklySessionDate}>
                              {new Date(sess.date).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})}
                            </span>
                            {sess.label && <span className={s.weeklySessionLabel}>{sess.label}</span>}
                            <span className={`${s.weeklyStatusBadge} ${s['weeklyBadge_' + sess.status]}`}>
                              {sess.status.charAt(0).toUpperCase() + sess.status.slice(1)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Consistency progress bar */}
                    {!cl.consistencyBonus && (
                      <div className={s.weeklyProgress}>
                        <div className={s.weeklyProgressBar}>
                          <div className={s.weeklyProgressFill}
                            style={{ width: `${Math.min(100, (cl.weekPresent / 4) * 100)}%` }} />
                        </div>
                        <span className={s.weeklyProgressLbl}>{cl.weekPresent}/4 for consistency bonus</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* ── Motivational Messages / Achievements ── */}
          {weeklyData?.notifications?.length > 0 && (
            <SectionCard icon="🏆" title="Achievements & Messages"
              subtitle="Motivational messages from your coordinators">
              <div className={s.notifList}>
                {weeklyData.notifications.map(n => (
                  <div key={n.id} className={`${s.notifCard} ${n.isRead ? s.notifRead : s.notifUnread}`}>
                    <div className={s.notifCardTop}>
                      <span className={s.notifTitle}>{n.title}</span>
                      {!n.isRead && (
                        <button className={s.notifMarkBtn} onClick={() => markNotifRead(n.id)}>
                          Mark read
                        </button>
                      )}
                    </div>
                    <p className={s.notifBody}>{n.body}</p>
                    <span className={s.notifTime}>
                      {new Date(n.createdAt).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* ── Danger zone ── */}
          <SectionCard icon="⚠️" title="Account" subtitle="Manage your session and account status">
            <div className={s.dangerList}>
              <div className={s.dangerRow}>
                <div>
                  <div className={s.dangerLabel}>Download my data</div>
                  <div className={s.dangerSub}>Export your club memberships, event history and profile data</div>
                </div>
                <button className={s.btnOutline} disabled>Coming Soon</button>
              </div>
              <div className={s.dangerRow} style={{ borderColor: '#fecaca' }}>
                <div>
                  <div className={s.dangerLabel} style={{ color: '#ef4444' }}>Deactivate account</div>
                  <div className={s.dangerSub}>Temporarily suspend your SOAC access — contact admin to restore</div>
                </div>
                <button className={s.btnDanger} disabled>Contact Admin</button>
              </div>
            </div>
          </SectionCard>

        </div>
      </div>
    </div>
  );
}
