import { useState, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import s from './ProfileModal.module.css';

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

export default function ProfileModal({ onClose }) {
  const { user, updateUser, refreshUser } = useAuth();

  const [tab, setTab] = useState('profile');

  // Profile tab
  const [name, setName]             = useState(user?.name || '');
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [saving, setSaving]         = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileOk, setProfileOk]   = useState(false);
  const fileInputRef = useRef(null);

  // Password tab
  const [currentPw, setCurrentPw]     = useState('');
  const [newPw, setNewPw]             = useState('');
  const [confirmPw, setConfirmPw]     = useState('');
  const [pwSaving, setPwSaving]       = useState(false);
  const [pwMsg, setPwMsg]             = useState('');
  const [pwOk, setPwOk]               = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]         = useState(false);

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
    setProfileMsg('');
    setProfileOk(false);
  };

  const handleProfileSave = async () => {
    const nameChanged   = name.trim() && name.trim() !== user?.name;
    const avatarChanged = !!avatarFile;

    if (!nameChanged && !avatarChanged) {
      setProfileMsg('No changes to save.');
      setProfileOk(false);
      return;
    }

    setSaving(true);
    setProfileMsg('');
    try {
      const fd = new FormData();
      if (nameChanged)   fd.append('name', name.trim());
      if (avatarChanged) fd.append('avatar', avatarFile);

      const { user: updated } = await api.putForm('/users/me/profile', fd);
      updateUser(updated);
      setAvatarFile(null);
      setProfileMsg('Profile updated successfully!');
      setProfileOk(true);
    } catch (err) {
      setProfileMsg(err.message || 'Update failed.');
      setProfileOk(false);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordSave = async () => {
    if (!currentPw || !newPw || !confirmPw) {
      setPwMsg('All fields are required.');
      setPwOk(false);
      return;
    }
    if (newPw.length < 8) {
      setPwMsg('New password must be at least 8 characters.');
      setPwOk(false);
      return;
    }
    if (newPw !== confirmPw) {
      setPwMsg('Passwords do not match.');
      setPwOk(false);
      return;
    }
    setPwSaving(true);
    setPwMsg('');
    try {
      await api.post('/auth/change-password', { currentPassword: currentPw, newPassword: newPw });
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      setPwMsg('Password changed successfully!');
      setPwOk(true);
      refreshUser();
    } catch (err) {
      setPwMsg(err.message || 'Failed to change password.');
      setPwOk(false);
    } finally {
      setPwSaving(false);
    }
  };

  // The displayed avatar: preview (newly selected file) > saved avatar > null (show initials)
  const displayUrl = avatarPreview || getAvatarUrl(user?.avatar);

  const roleLabel = {
    admin:       'Administrator',
    coordinator: 'Club Coordinator',
    student:     'Student',
  }[user?.role] || user?.role;

  const pwStrength = (() => {
    if (!newPw) return null;
    let score = 0;
    if (newPw.length >= 8)             score++;
    if (newPw.length >= 12)            score++;
    if (/[A-Z]/.test(newPw))           score++;
    if (/[0-9]/.test(newPw))           score++;
    if (/[^A-Za-z0-9]/.test(newPw))    score++;
    if (score <= 1) return { label: 'Weak',   color: '#ef4444', pct: 25  };
    if (score <= 2) return { label: 'Fair',   color: '#f59e0b', pct: 50  };
    if (score <= 3) return { label: 'Good',   color: '#3b82f6', pct: 75  };
    return               { label: 'Strong', color: '#22c55e', pct: 100 };
  })();

  return (
    <div className={s.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={s.modal}>

        {/* Close */}
        <button className={s.closeBtn} onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {/* ── Hero ── */}
        <div className={s.hero}>
          {/* Avatar — same circular frame as the About page task force */}
          <div className={s.avatarFrame}>
            {displayUrl ? (
              <img
                src={displayUrl}
                alt={user?.name}
                className={s.avatarPhoto}
                onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
              />
            ) : null}
            <div
              className={s.avatarFallback}
              style={{
                display: displayUrl ? 'none' : 'flex',
                background: `hsl(${getHue(user?.name)},60%,52%)`,
              }}
            >
              {getInitials(user?.name)}
            </div>

            {/* Edit overlay */}
            <button
              className={s.avatarOverlay}
              onClick={() => fileInputRef.current?.click()}
              title="Change photo"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
              <span>Change</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={handleAvatarChange}
            />
          </div>

          <div className={s.heroInfo}>
            <div className={s.heroName}>{user?.name}</div>
            <div className={s.heroEmail}>{user?.email}</div>
            <span className={s.heroBadge}>{roleLabel}</span>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className={s.tabs}>
          <button
            className={`${s.tab} ${tab === 'profile' ? s.tabActive : ''}`}
            onClick={() => setTab('profile')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            Edit Profile
          </button>
          <button
            className={`${s.tab} ${tab === 'password' ? s.tabActive : ''}`}
            onClick={() => setTab('password')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Change Password
          </button>
        </div>

        {/* ── Tab: Profile ── */}
        {tab === 'profile' && (
          <div className={s.tabBody}>
            {avatarFile && (
              <div className={s.photoHint}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
                New photo ready — click Save to apply
              </div>
            )}

            <div className={s.field}>
              <label className={s.label}>Display Name</label>
              <input
                className={s.input}
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your full name"
                maxLength={80}
              />
            </div>

            <div className={s.field}>
              <label className={s.label}>Email</label>
              <input className={s.input} value={user?.email || ''} disabled />
              <span className={s.hint}>Email address cannot be changed.</span>
            </div>

            <div className={s.field}>
              <label className={s.label}>Role</label>
              <input className={s.input} value={roleLabel} disabled />
            </div>

            {profileMsg && (
              <div className={profileOk ? s.successMsg : s.errorMsg}>{profileMsg}</div>
            )}

            <button className={s.saveBtn} onClick={handleProfileSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}

        {/* ── Tab: Password ── */}
        {tab === 'password' && (
          <div className={s.tabBody}>
            <div className={s.field}>
              <label className={s.label}>Current Password</label>
              <div className={s.pwWrap}>
                <input
                  className={s.input}
                  type={showCurrent ? 'text' : 'password'}
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  placeholder="Enter current password"
                />
                <button className={s.eyeBtn} type="button" onClick={() => setShowCurrent(v => !v)}>
                  {showCurrent ? '🙈' : '👁️'}
                </button>
              </div>
            </div>

            <div className={s.field}>
              <label className={s.label}>New Password</label>
              <div className={s.pwWrap}>
                <input
                  className={s.input}
                  type={showNew ? 'text' : 'password'}
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder="Minimum 8 characters"
                />
                <button className={s.eyeBtn} type="button" onClick={() => setShowNew(v => !v)}>
                  {showNew ? '🙈' : '👁️'}
                </button>
              </div>
              {pwStrength && (
                <div className={s.strengthWrap}>
                  <div className={s.strengthBar}>
                    <div className={s.strengthFill} style={{ width: pwStrength.pct + '%', background: pwStrength.color }} />
                  </div>
                  <span style={{ color: pwStrength.color, fontSize: 11, fontWeight: 700, minWidth: 42 }}>
                    {pwStrength.label}
                  </span>
                </div>
              )}
            </div>

            <div className={s.field}>
              <label className={s.label}>Confirm New Password</label>
              <input
                className={s.input}
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                placeholder="Re-enter new password"
              />
              {confirmPw && newPw !== confirmPw && (
                <span className={s.hint} style={{ color: '#ef4444' }}>Passwords do not match.</span>
              )}
            </div>

            {pwMsg && (
              <div className={pwOk ? s.successMsg : s.errorMsg}>{pwMsg}</div>
            )}

            <button className={s.saveBtn} onClick={handlePasswordSave} disabled={pwSaving}>
              {pwSaving ? 'Changing…' : 'Change Password'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
