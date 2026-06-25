import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import s from './CoordMessages.module.css';

const AVATAR_BASE = '/uploads/avatars/';

function initials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function timeFmt(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function convTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr), now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  const diff = Math.floor((now - d) / 86400000);
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'numeric' });
}
function dayLabel(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr), now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function MemberAv({ avatar, name, color, size = 40 }) {
  const [err, setErr] = useState(false);
  if (avatar && !err) {
    return (
      <img src={avatar.startsWith('http') ? avatar : AVATAR_BASE + avatar} alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color || 'linear-gradient(135deg,#4c44e0,#6b3fa0)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 800, color: '#fff', flexShrink: 0,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      {initials(name)}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
══════════════════════════════════════════════════════════ */
export default function CoordMessages() {
  const { user }         = useAuth();
  const { selectedClub } = useCoordClub();
  const managedClubId    = selectedClub?.id;

  /* ── Club group chat ── */
  const [clubInfo,       setClubInfo]       = useState(null);
  const [clubMsgs,       setClubMsgs]       = useState([]);
  const [clubMsgsLoaded, setClubMsgsLoaded] = useState(false);
  const [clubErr,        setClubErr]        = useState('');

  /* ── DM conversation list (from API) ── */
  const [dmThreads,    setDmThreads]    = useState([]);
  const [convsLoaded,  setConvsLoaded]  = useState(false);

  /* ── Compose panel ── */
  const [composing,   setComposing]   = useState(false);
  const [clubMembers, setClubMembers] = useState([]);
  const [membLoaded,  setMembLoaded]  = useState(false);
  const [membFilter,  setMembFilter]  = useState('');

  /* ── Active pane: null | 'group' | 'dm' ── */
  const [activeType, setActiveType] = useState(null);
  const [activeDM,   setActiveDM]   = useState(null); // { id, name, avatar }

  /* ── DM messages ── */
  const [dmMsgs,       setDmMsgs]       = useState([]);
  const [dmMsgsLoaded, setDmMsgsLoaded] = useState(false);
  const [dmErr,        setDmErr]        = useState('');

  /* ── Shared ── */
  const [input,   setInput]   = useState('');
  const [sending, setSending] = useState(false);
  const [search,  setSearch]  = useState('');

  const groupLastIdRef = useRef(null);
  const groupSeenIds   = useRef(new Set());
  const dmLastIdRef    = useRef(null);
  const dmSeenIds      = useRef(new Set());
  const chatEndRef     = useRef(null);
  const inputRef       = useRef(null);

  /* ── Load DM conversation list ── */
  const loadConvs = useCallback(async () => {
    try {
      const data = await api.get('/messages/conversations');
      setDmThreads(data.dms || []);
    } catch (_) {}
    setConvsLoaded(true);
  }, []);

  useEffect(() => {
    loadConvs();
    const t = setInterval(loadConvs, 5000);
    return () => clearInterval(t);
  }, [loadConvs]);

  /* ── Load members for compose panel ── */
  const loadMembers = useCallback(async () => {
    if (membLoaded) return;
    try {
      const { members } = await api.get('/messages/members');
      setClubMembers(members || []);
    } catch (_) {}
    setMembLoaded(true);
  }, [membLoaded]);

  /* ── Load club info ── */
  useEffect(() => {
    if (!managedClubId) return;
    api.get(`/clubs/${managedClubId}`).then(r => setClubInfo(r.club)).catch(() => {});
  }, [managedClubId]);

  /* ── Load group messages (initial) ── */
  useEffect(() => {
    if (activeType !== 'group' || !managedClubId) return;
    let dead = false;
    setClubMsgsLoaded(false);
    setClubErr('');
    groupLastIdRef.current = null;
    groupSeenIds.current   = new Set();

    api.get(`/clubs/${managedClubId}/messages?limit=60`)
      .then(r => {
        if (dead) return;
        const msgs = r.messages || [];
        groupSeenIds.current = new Set(msgs.map(m => String(m.id)));
        setClubMsgs(msgs);
        if (msgs.length) groupLastIdRef.current = msgs[msgs.length - 1].id;
        setClubMsgsLoaded(true);
      })
      .catch(err => {
        if (!dead) { setClubErr(err.message || 'Could not load messages.'); setClubMsgsLoaded(true); }
      });

    return () => { dead = true; };
  }, [activeType, managedClubId]);

  /* ── Poll for new group messages ── */
  useEffect(() => {
    if (activeType !== 'group' || !managedClubId || !clubMsgsLoaded) return;
    let dead = false;

    const poll = async () => {
      if (!groupLastIdRef.current) return;
      try {
        const r = await api.get(`/clubs/${managedClubId}/messages?after=${groupLastIdRef.current}`);
        const fresh = (r.messages || []).filter(m => !groupSeenIds.current.has(String(m.id)));
        if (dead || !fresh.length) return;
        fresh.forEach(m => groupSeenIds.current.add(String(m.id)));
        setClubMsgs(prev => [...prev, ...fresh]);
        groupLastIdRef.current = fresh[fresh.length - 1].id;
      } catch (_) {}
    };

    const t = setInterval(poll, 8000);
    return () => { dead = true; clearInterval(t); };
  }, [activeType, managedClubId, clubMsgsLoaded]);

  /* ── Load DM messages (initial) ── */
  useEffect(() => {
    if (activeType !== 'dm' || !activeDM) return;
    let dead = false;
    setDmMsgsLoaded(false);
    setDmErr('');
    dmLastIdRef.current = null;
    dmSeenIds.current   = new Set();

    api.get(`/messages/dm/${activeDM.id}`)
      .then(r => {
        if (dead) return;
        const msgs = r.messages || [];
        dmSeenIds.current = new Set(msgs.map(m => String(m.id)));
        setDmMsgs(msgs);
        dmLastIdRef.current = msgs.length ? msgs[msgs.length - 1].id : '0';
        setDmMsgsLoaded(true);
      })
      .catch(err => {
        if (!dead) { setDmErr(err.message || 'Could not load messages.'); setDmMsgsLoaded(true); }
      });

    return () => { dead = true; };
  }, [activeType, activeDM?.id]); // eslint-disable-line

  /* ── Poll for new DM messages ── */
  useEffect(() => {
    if (activeType !== 'dm' || !activeDM || !dmMsgsLoaded) return;
    let dead = false;

    const poll = async () => {
      const after = dmLastIdRef.current ?? '0';
      try {
        const r = await api.get(`/messages/dm/${activeDM.id}?after=${after}`);
        const fresh = (r.messages || []).filter(m => !dmSeenIds.current.has(String(m.id)));
        if (dead || !fresh.length) return;
        fresh.forEach(m => dmSeenIds.current.add(String(m.id)));
        setDmMsgs(prev => [...prev, ...fresh]);
        dmLastIdRef.current = fresh[fresh.length - 1].id;
      } catch (_) {}
    };

    const t = setInterval(poll, 6000);
    return () => { dead = true; clearInterval(t); };
  }, [activeType, activeDM?.id, dmMsgsLoaded]); // eslint-disable-line

  /* ── Auto-scroll ── */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [clubMsgs.length, dmMsgs.length]);

  /* ── Send message ── */
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);

    if (activeType === 'group') {
      if (!managedClubId) { setSending(false); return; }
      setClubErr('');
      try {
        const r = await api.post(`/clubs/${managedClubId}/messages`, { content: text });
        const msg = r.message;
        if (msg && !groupSeenIds.current.has(String(msg.id))) {
          groupSeenIds.current.add(String(msg.id));
          setClubMsgs(prev => [...prev, msg]);
          groupLastIdRef.current = msg.id;
        }
        setInput('');
      } catch (err) {
        setClubErr(err.message || 'Failed to send.');
      }

    } else if (activeType === 'dm' && activeDM) {
      const content = text.replace(/\0/g, '').replace(/\r\n|\r/g, '\n');
      const tempId  = `_opt_${Date.now()}`;
      const optimistic = {
        id: tempId, from_user: user?.id, to_user: Number(activeDM.id),
        content, created_at: new Date().toISOString(),
        from_name: user?.name, from_avatar: user?.avatar || '',
        _pending: true,
      };
      setInput('');
      setDmMsgs(prev => [...prev, optimistic]);
      setDmErr('');
      try {
        const r   = await api.post(`/messages/dm/${activeDM.id}`, { content });
        const msg = r.message;
        setDmMsgs(prev => prev.map(m => m.id === tempId ? msg : m));
        if (!dmSeenIds.current.has(String(msg.id))) {
          dmSeenIds.current.add(String(msg.id));
          dmLastIdRef.current = msg.id;
        }
        loadConvs();
      } catch (err) {
        setDmMsgs(prev => prev.filter(m => m.id !== tempId));
        setInput(content);
        setDmErr(err.message || 'Failed to send. Message restored — try again.');
      }
    }

    setSending(false);
  }, [input, sending, activeType, managedClubId, activeDM, user, loadConvs]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /* ── Open group chat ── */
  const openGroup = () => {
    setActiveType('group');
    setActiveDM(null);
    setInput('');
    setClubErr('');
    setDmErr('');
  };

  /* ── Open DM ── */
  const openDM = useCallback((partner) => {
    const pid = String(partner.id ?? partner.partner_id);
    if (activeType === 'dm' && activeDM?.id === pid) return;
    setActiveType('dm');
    setActiveDM({
      id: pid,
      name:   partner.name   ?? partner.partner_name,
      avatar: partner.avatar ?? partner.partner_avatar ?? null,
    });
    setDmMsgs([]);
    setDmMsgsLoaded(false);
    setInput('');
    setDmErr('');
    dmLastIdRef.current = null;
    dmSeenIds.current   = new Set();
    setTimeout(() => inputRef.current?.focus(), 80);
  }, [activeType, activeDM?.id]);

  /* ── Start DM from compose panel ── */
  const startDM = (member) => {
    setComposing(false);
    setMembFilter('');
    openDM(member);
  };

  /* ── Derived values ── */
  const clubColor    = clubInfo?.color || '#4c44e0';
  const totalUnread  = dmThreads.reduce((a, d) => a + (d.unread_count || 0), 0);

  const filteredThreads = search
    ? dmThreads.filter(d => d.partner_name?.toLowerCase().includes(search.toLowerCase()))
    : dmThreads;

  const mq           = membFilter.trim().toLowerCase();
  const mVisible     = mq
    ? clubMembers.filter(m =>
        m.name?.toLowerCase().includes(mq) ||
        m.club_name?.toLowerCase().includes(mq) ||
        m.dept?.toLowerCase().includes(mq) ||
        m.year?.toLowerCase().includes(mq) ||
        m.role?.toLowerCase().includes(mq)
      )
    : clubMembers;
  const staffVisible   = mVisible.filter(m => m.role === 'admin' || m.role === 'coordinator');
  const membersVisible = mVisible.filter(m => m.role !== 'admin' && m.role !== 'coordinator');

  /* ══════════════ RENDER ══════════════ */
  return (
    <div className={s.page}>

      {/* ════ SIDEBAR ════ */}
      <div className={s.sidebar}>
        <div className={s.sidebarHead}>

          {/* Header row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            {composing ? (
              <>
                <button className={s.iconBtn} onClick={() => { setComposing(false); setMembFilter(''); }}>
                  <ArrowLeft />
                </button>
                <div className={s.sidebarTitle} style={{ marginBottom: 0, flex: 1 }}>New Message</div>
              </>
            ) : (
              <>
                <div className={s.sidebarTitle} style={{ marginBottom: 0 }}>
                  Messages
                  {totalUnread > 0 && <span className={s.totalBadge}>{totalUnread}</span>}
                </div>
                <button className={s.iconBtn} title="New message"
                  onClick={() => { setComposing(true); loadMembers(); }}>
                  <ComposeIco />
                </button>
              </>
            )}
          </div>

          {/* Search */}
          <div className={s.searchWrap}>
            <svg className={s.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              className={s.searchInput}
              placeholder={composing ? 'Search by name, dept, role…' : 'Search conversations…'}
              value={composing ? membFilter : search}
              onChange={e => composing ? setMembFilter(e.target.value) : setSearch(e.target.value)}
              autoFocus={composing}
            />
          </div>
        </div>

        <div className={s.contactList}>
          {composing ? (
            /* ── Compose: member search panel ── */
            <>
              {!membLoaded && <div className={s.centreLoad}><div className={s.spinner} /></div>}
              {membLoaded && mVisible.length === 0 && (
                <div className={s.groupEmpty} style={{ paddingTop: 36 }}>
                  <p>{membFilter ? 'No people match.' : 'No members found.'}</p>
                </div>
              )}
              {staffVisible.length > 0 && (
                <>
                  <div className={s.sectionLabel}>ADMIN &amp; COORDINATORS</div>
                  {staffVisible.map(m => (
                    <MemberRow key={m.id} member={m} onClick={() => startDM(m)} />
                  ))}
                </>
              )}
              {membersVisible.length > 0 && (
                <>
                  <div className={s.sectionLabel}>CLUB MEMBERS</div>
                  {membersVisible.map(m => (
                    <MemberRow key={m.id} member={m} onClick={() => startDM(m)} />
                  ))}
                </>
              )}
            </>
          ) : (
            /* ── Conversation list ── */
            <>
              {/* Club group chat pinned at top */}
              {managedClubId && (
                <>
                  <div className={s.sectionLabel}>CLUB GROUP CHAT</div>
                  <div
                    className={`${s.contactRow} ${s.groupRow} ${activeType === 'group' ? s.contactActive : ''}`}
                    onClick={openGroup}
                  >
                    <div className={s.contactAvWrap}>
                      <div className={s.groupAv} style={{ background: clubColor }}>
                        {initials(clubInfo?.name || '…')}
                      </div>
                    </div>
                    <div className={s.contactInfo}>
                      <div className={s.contactName}>
                        {clubInfo?.name || 'My Club'}
                        <span className={s.livePill}>LIVE</span>
                      </div>
                      <div className={s.contactLast}>
                        {clubMsgs.length > 0
                          ? clubMsgs[clubMsgs.length - 1].content
                          : 'Send a message to your club members'}
                      </div>
                    </div>
                  </div>
                  <div className={s.sectionLabel} style={{ marginTop: 4 }}>DIRECT MESSAGES</div>
                </>
              )}

              {/* Real DM threads */}
              {!convsLoaded && <div className={s.centreLoad}><div className={s.spinner} /></div>}
              {convsLoaded && filteredThreads.length === 0 && (
                <div className={s.groupEmpty} style={{ padding: '28px 16px', fontSize: '0.8rem', color: '#9ca3af' }}>
                  {search ? 'No matches.' : 'No direct messages yet. Tap + to start one.'}
                </div>
              )}
              {filteredThreads.map(dm => (
                <div key={dm.partner_id}
                  className={`${s.contactRow} ${activeType === 'dm' && activeDM?.id === String(dm.partner_id) ? s.contactActive : ''}`}
                  onClick={() => openDM(dm)}
                >
                  <div className={s.contactAvWrap}>
                    <MemberAv avatar={dm.partner_avatar} name={dm.partner_name} size={40} />
                  </div>
                  <div className={s.contactInfo}>
                    <div className={s.contactName}>{dm.partner_name}</div>
                    <div className={s.contactLast}>
                      {dm.is_mine ? 'You: ' : ''}{dm.last_message || 'No messages yet'}
                    </div>
                  </div>
                  <div className={s.contactMeta}>
                    {dm.last_at && <div className={s.contactTime}>{convTime(dm.last_at)}</div>}
                    {(dm.unread_count || 0) > 0 && !(activeType === 'dm' && activeDM?.id === String(dm.partner_id)) && (
                      <span className={s.unreadBadge}>{dm.unread_count > 99 ? '99+' : dm.unread_count}</span>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ════ CHAT PANEL ════ */}
      <div className={s.chat}>

        {/* Welcome screen */}
        {activeType === null && (
          <div className={s.welcome}>
            <div className={s.welcomeRing}>
              <svg viewBox="0 0 52 52" fill="none" width="52" height="52">
                <circle cx="26" cy="26" r="25" stroke="#4c44e0" strokeWidth="2" opacity=".25"/>
                <path d="M16 26c0-5.52 4.48-10 10-10s10 4.48 10 10-4.48 10-10 10c-1.85 0-3.58-.51-5.07-1.38L16 36l1.38-4.93A9.96 9.96 0 0 1 16 26z"
                  fill="#4c44e0" opacity=".9"/>
              </svg>
            </div>
            <div className={s.welcomeTitle}>SOAC Messages</div>
            <div className={s.welcomeSub}>
              Select a conversation, open your club chat,<br/>or start a new direct message.
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
              {managedClubId && (
                <button className={s.welcomeNew} onClick={openGroup}>Open Club Chat</button>
              )}
              <button className={s.welcomeNew} onClick={() => { setComposing(true); loadMembers(); }}>
                + New Message
              </button>
            </div>
          </div>
        )}

        {/* Group chat pane */}
        {activeType === 'group' && managedClubId && (
          <>
            <div className={s.chatHeader}>
              <div className={s.chatHeaderLeft}>
                <div className={s.groupAv} style={{ background: clubColor, width: 40, height: 40, fontSize: 14 }}>
                  {initials(clubInfo?.name || '…')}
                </div>
                <div>
                  <div className={s.chatName}>{clubInfo?.name || 'Club Group Chat'}</div>
                  <div className={s.chatRole}>Group Chat · all members can read and reply</div>
                </div>
              </div>
            </div>

            <div className={s.groupBody}>
              {!clubMsgsLoaded && <div className={s.centreLoad}><div className={s.spinner} /></div>}
              {clubMsgsLoaded && clubMsgs.length === 0 && !clubErr && (
                <div className={s.groupEmpty}><span>💬</span><p>No messages yet — say hello to your club!</p></div>
              )}
              {clubMsgs.map((msg, i) => {
                const isMe   = msg.user_id === user?.id;
                const prev   = clubMsgs[i - 1];
                const grouped = !!prev && prev.user_id === msg.user_id
                  && (new Date(msg.created_at) - new Date(prev.created_at)) < 300000;
                const newDay  = i === 0
                  || new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString();
                return (
                  <div key={msg.id}>
                    {newDay && <div className={s.daySep}><span>{dayLabel(msg.created_at)}</span></div>}
                    <div className={`${s.gmRow} ${isMe ? s.gmMe : ''} ${grouped ? s.gmGrouped : ''}`}>
                      {!isMe && (
                        <div className={s.gmAv}>
                          {!grouped
                            ? <MemberAv avatar={msg.user_avatar} name={msg.user_name} color={clubColor} size={30} />
                            : <div style={{ width: 30 }} />}
                        </div>
                      )}
                      <div className={s.gmCol}>
                        {!grouped && !isMe && (
                          <div className={s.gmSenderRow}>
                            <span className={s.gmSender} style={{ color: clubColor }}>{msg.user_name}</span>
                            {(msg.user_role === 'coordinator' || msg.user_role === 'admin') && (
                              <span className={s.roleBadge}>
                                {msg.user_role === 'admin' ? 'Admin' : 'Coordinator'}
                              </span>
                            )}
                          </div>
                        )}
                        <div className={`${s.gmBubble} ${isMe ? s.gmBubbleMe : s.gmBubbleThem}`}>
                          {msg.content}
                          <span className={s.gmTs}>{timeFmt(msg.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {clubErr && <div className={s.errStripe}>{clubErr}</div>}
            <div className={s.inputRow}>
              <input
                ref={inputRef}
                className={s.msgInput}
                placeholder="Message your club…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                disabled={sending}
                maxLength={2000}
              />
              <button className={s.sendBtn} onClick={handleSend} disabled={!input.trim() || sending}>
                {sending
                  ? <div className={s.spinnerSm} />
                  : <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                    </svg>}
              </button>
            </div>
          </>
        )}

        {/* Group selected but no club assigned */}
        {activeType === 'group' && !managedClubId && (
          <div className={s.welcome}>
            <div className={s.welcomeTitle}>No club assigned</div>
            <div className={s.welcomeSub}>Contact the admin to be assigned as a club coordinator.</div>
          </div>
        )}

        {/* DM pane */}
        {activeType === 'dm' && activeDM && (
          <>
            <div className={s.chatHeader}>
              <div className={s.chatHeaderLeft}>
                <MemberAv avatar={activeDM.avatar} name={activeDM.name} size={40} />
                <div>
                  <div className={s.chatName}>{activeDM.name}</div>
                  <div className={s.chatRole}>Direct Message</div>
                </div>
              </div>
            </div>

            <div className={s.messages}>
              {!dmMsgsLoaded && <div className={s.centreLoad}><div className={s.spinner} /></div>}
              {dmMsgsLoaded && dmMsgs.length === 0 && !dmErr && (
                <div className={s.groupEmpty}><span>👋</span><p>No messages yet — say hello!</p></div>
              )}
              {dmMsgs.map((msg, i) => {
                const isMe   = msg.from_user === user?.id;
                const prev   = dmMsgs[i - 1];
                const grouped = !!prev && prev.from_user === msg.from_user
                  && (new Date(msg.created_at) - new Date(prev.created_at)) < 300000;
                const newDay  = i === 0
                  || new Date(msg.created_at).toDateString() !== new Date(prev.created_at).toDateString();
                return (
                  <div key={msg.id}>
                    {newDay && <div className={s.daySep}><span>{dayLabel(msg.created_at)}</span></div>}
                    <div className={`${s.msgRow} ${isMe ? s.msgMe : s.msgThem}`}>
                      {!isMe && (
                        <div className={s.msgAv} style={{ background: 'linear-gradient(135deg,#4c44e0,#6b3fa0)' }}>
                          <MemberAv avatar={msg.from_avatar || activeDM.avatar} name={msg.from_name || activeDM.name} size={28} />
                        </div>
                      )}
                      <div className={s.msgBubbleWrap}>
                        <div className={`${isMe ? s.bubbleMe : s.bubbleThem}${msg._pending ? ` ${s.bubblePending}` : ''}`}>
                          {msg._pending ? '…' : msg.content}
                        </div>
                        <div className={s.msgTime}>{timeFmt(msg.created_at)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {dmErr && <div className={s.errStripe}>{dmErr}</div>}
            <div className={s.inputRow}>
              <input
                ref={inputRef}
                className={s.msgInput}
                placeholder={`Message ${activeDM.name}…`}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKey}
                disabled={sending}
                maxLength={2000}
              />
              <button className={s.sendBtn} onClick={handleSend} disabled={!input.trim() || sending}>
                {sending
                  ? <div className={s.spinnerSm} />
                  : <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                    </svg>}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

/* ── Member row in compose panel ── */
function MemberRow({ member, onClick }) {
  return (
    <div className={s.contactRow} onClick={onClick} style={{ cursor: 'pointer' }}>
      <div className={s.contactAvWrap}>
        <MemberAv avatar={member.avatar} name={member.name} size={40} />
      </div>
      <div className={s.contactInfo}>
        <div className={s.contactName}>
          {member.name}
          {(member.role === 'coordinator' || member.role === 'admin') && (
            <span className={s.roleBadge} style={{ marginLeft: 5 }}>
              {member.role === 'admin' ? 'Admin' : 'Coord'}
            </span>
          )}
        </div>
        <div className={s.contactLast}>
          {[member.dept, member.year].filter(Boolean).join(' · ') || member.club_name || ''}
        </div>
      </div>
    </div>
  );
}

function ArrowLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
      <path d="M19 12H5M12 5l-7 7 7 7"/>
    </svg>
  );
}
function ComposeIco() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}
