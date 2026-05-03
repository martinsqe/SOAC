import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import s from './AdminMonitorChats.module.css';

const AVATAR_BASE = '/uploads/avatars/';
const ACCENT      = '#635bff';

/* ── helpers ── */
function avatarUrl(f) { return f ? AVATAR_BASE + f : ''; }

function convTime(dateStr) {
  if (!dateStr) return '';
  const d   = new Date(dateStr);
  const now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  const diff = Math.floor((now - d) / 86400000);
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'numeric' });
}

function msgTimeFmt(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(dateStr) {
  if (!dateStr) return '';
  const d   = new Date(dateStr);
  const now = new Date();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString())  return 'Today';
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

/* ── Avatar ── */
function InitAv({ name, color = ACCENT, size = 40 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', background: color, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, color: '#fff', fontSize: size * 0.4,
    }}>
      {name?.charAt(0)?.toUpperCase() || '?'}
    </div>
  );
}

function UserAv({ src, name, color = ACCENT, size = 40 }) {
  const [err, setErr] = useState(false);
  if (src && !err) {
    return (
      <img src={src} alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={() => setErr(true)}
      />
    );
  }
  return <InitAv name={name} color={color} size={size} />;
}

/* ── Build sorted sidebar list ── */
function buildList(groups, dms) {
  const list = [
    ...groups.map(g => ({
      key: `g_${g.id}`, type: 'group', id: String(g.id),
      name: g.name, color: g.color || ACCENT, avatarFile: null,
      lastMsg: g.last_message || '', lastSender: g.last_sender || '', lastAt: g.last_at,
    })),
    ...dms.map(d => ({
      key: `d_${d.partner_id}`, type: 'dm', id: String(d.partner_id),
      name: d.partner_name, color: ACCENT, avatarFile: d.partner_avatar || null,
      lastMsg: d.last_message || '',
      lastSender: d.is_mine ? 'You' : (d.partner_name?.split(' ')[0] || ''),
      lastAt: d.last_at,
      unread: d.unread_count || 0,
    })),
  ];
  list.sort((a, b) => {
    if (!a.lastAt && !b.lastAt) return 0;
    if (!a.lastAt) return 1;
    if (!b.lastAt) return -1;
    return new Date(b.lastAt) - new Date(a.lastAt);
  });
  return list;
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════ */
export default function AdminMonitorChats() {
  const { user } = useAuth();

  /* sidebar */
  const [convList,    setConvList]    = useState([]);
  const [convsLoaded, setConvsLoaded] = useState(false);
  const [filter,      setFilter]      = useState('');
  const [sideTab,     setSideTab]     = useState('groups'); // 'groups' | 'dms'

  /* compose-new-DM mode */
  const [composing,   setComposing]   = useState(false);
  const [clubMembers, setClubMembers] = useState([]);
  const [membLoaded,  setMembLoaded]  = useState(false);
  const [membFilter,  setMembFilter]  = useState('');

  /* active conversation */
  const [activeConv,     setActiveConv]     = useState(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);

  /* chat */
  const [messages,   setMessages]   = useState([]);
  const [msgsLoaded, setMsgsLoaded] = useState(false);
  const [chatInput,  setChatInput]  = useState('');
  const [sending,    setSending]    = useState(false);
  const [chatErr,    setChatErr]    = useState('');

  const lastIdRef     = useRef(null);
  const seenIds       = useRef(new Set());
  const activeConvRef = useRef(null);
  const chatEndRef    = useRef(null);
  const inputRef      = useRef(null);
  const prevUnreadRef = useRef(0);  // tracks DM unread total across polls

  /* ── Load conversation list (5 s refresh for near-realtime DM detection) ── */
  const loadConvs = useCallback(async () => {
    try {
      const data = await api.get('/messages/conversations');
      const list = buildList(data.groups || [], data.dms || []);
      setConvList(list);

      /* Auto-switch to DMs tab when a new unread message arrives */
      const nowUnread = list.filter(c => c.type === 'dm').reduce((n, c) => n + (c.unread || 0), 0);
      if (nowUnread > prevUnreadRef.current) {
        setSideTab('dms');
      }
      prevUnreadRef.current = nowUnread;
    } catch (_) {}
    setConvsLoaded(true);
  }, []);

  useEffect(() => {
    loadConvs();
    const t = setInterval(loadConvs, 5000);
    return () => clearInterval(t);
  }, [loadConvs]);

  /* ── Load all members once (for compose) ── */
  const loadMembers = useCallback(async () => {
    if (membLoaded) return;
    try {
      const { members } = await api.get('/messages/members');
      setClubMembers(members || []);
    } catch (_) {}
    setMembLoaded(true);
  }, [membLoaded]);

  /* ── Open a conversation ── */
  const openConv = useCallback((conv) => {
    const prev   = activeConvRef.current;
    const isSame = prev?.type === conv.type && prev?.id === conv.id;
    if (!isSame) {
      setMessages([]);
      setMsgsLoaded(false);
      setChatErr('');
      setChatInput('');
      lastIdRef.current = null;
      seenIds.current   = new Set();
    }
    activeConvRef.current = conv;
    setActiveConv(conv);
    setMobileShowChat(true);
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  /* ── Start DM from compose panel ── */
  const startDM = useCallback((member) => {
    setComposing(false);
    setMembFilter('');
    const existing = convList.find(c => c.type === 'dm' && c.id === String(member.id));
    openConv(existing ?? {
      key: `d_${member.id}`, type: 'dm', id: String(member.id),
      name: member.name, color: ACCENT, avatarFile: member.avatar || null,
      lastMsg: '', lastSender: '', lastAt: null,
    });
    setSideTab('dms');
  }, [convList, openConv]);

  /* ── Fetch initial messages ── */
  useEffect(() => {
    if (!activeConv) return;
    let dead = false;
    (async () => {
      try {
        let msgs = [];
        if (activeConv.type === 'group') {
          const r = await api.get(`/clubs/${activeConv.id}/messages?limit=60`);
          msgs = r.messages || [];
        } else {
          const r = await api.get(`/messages/dm/${activeConv.id}`);
          msgs = r.messages || [];
        }
        if (dead) return;
        seenIds.current   = new Set(msgs.map(m => String(m.id)));
        setMessages(msgs);
        /* Always anchor the poll — use '0' when thread is empty so the first
           incoming message is still caught by `id > 0` */
        lastIdRef.current = msgs.length ? msgs[msgs.length - 1].id : '0';
        setMsgsLoaded(true);
      } catch (err) {
        if (!dead) { setChatErr(err.message || 'Could not load messages.'); setMsgsLoaded(true); }
      }
    })();
    return () => { dead = true; };
  }, [activeConv?.type, activeConv?.id]); // eslint-disable-line

  /* ── 2 s poll for new messages ── */
  useEffect(() => {
    if (!activeConv || !msgsLoaded) return;
    let dead = false;
    const poll = async () => {
      /* lastIdRef is always a defined value ('0' for empty threads, real id otherwise) */
      const after = lastIdRef.current ?? '0';
      try {
        let fresh = [];
        if (activeConv.type === 'group') {
          const r = await api.get(`/clubs/${activeConv.id}/messages?after=${after}`);
          fresh = (r.messages || []).filter(m => !seenIds.current.has(String(m.id)));
        } else {
          const r = await api.get(`/messages/dm/${activeConv.id}?after=${after}`);
          fresh = (r.messages || []).filter(m => !seenIds.current.has(String(m.id)));
        }
        if (dead || !fresh.length) return;
        fresh.forEach(m => seenIds.current.add(String(m.id)));
        setMessages(prev => [...prev, ...fresh]);
        lastIdRef.current = fresh[fresh.length - 1].id;
      } catch (_) {}
    };
    const t = setInterval(poll, 2000);
    return () => { dead = true; clearInterval(t); };
  }, [activeConv?.type, activeConv?.id, msgsLoaded]); // eslint-disable-line

  /* Auto-scroll */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  /* ── Send message — optimistic UI ── */
  const handleSend = async (e) => {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || sending || !activeConv) return;

    /* Sanitise: strip null bytes, collapse excessive whitespace */
    const content = text.replace(/\0/g, '').replace(/\r\n|\r/g, '\n');
    if (!content || content.length > 2000) return;

    /* Optimistic placeholder — visible immediately */
    const tempId = `_opt_${Date.now()}`;
    const optimistic = activeConv.type === 'group'
      ? { id: tempId, user_id: user?.id, user_name: user?.name || 'Admin',
          user_avatar: '', user_role: 'admin', content, created_at: new Date().toISOString(), _pending: true }
      : { id: tempId, from_user: user?.id, to_user: parseInt(activeConv.id, 10),
          from_name: user?.name || 'Admin', from_avatar: '',
          content, read_at: null, created_at: new Date().toISOString(), _pending: true };

    setChatInput('');
    setChatErr('');
    setMessages(prev => [...prev, optimistic]);
    setSending(true);

    try {
      let msg;
      if (activeConv.type === 'group') {
        const r = await api.post(`/clubs/${activeConv.id}/messages`, { content });
        msg = r.message;
      } else {
        const r = await api.post(`/messages/dm/${activeConv.id}`, { content });
        msg = r.message;
      }

      if (msg) {
        const realId = String(msg.id);
        seenIds.current.add(realId);
        lastIdRef.current = msg.id;
        /* Swap optimistic placeholder with the confirmed message */
        setMessages(prev => prev.map(m => m.id === tempId ? msg : m));
      } else {
        /* No message returned — remove placeholder */
        setMessages(prev => prev.filter(m => m.id !== tempId));
      }
      loadConvs();
    } catch (err) {
      /* Roll back: remove placeholder + restore input so admin can retry */
      setMessages(prev => prev.filter(m => m.id !== tempId));
      setChatInput(content);
      setChatErr(err.message || 'Failed to send. Message restored — try again.');
    } finally {
      setSending(false);
    }
  };

  /* ── Message helpers ── */
  const isMe         = m => activeConv?.type === 'group' ? m.user_id === user?.id : m.from_user === user?.id;
  const senderName   = m => activeConv?.type === 'group' ? m.user_name   : m.from_name;
  const senderAvFile = m => activeConv?.type === 'group' ? m.user_avatar : m.from_avatar;

  /* ── Sidebar filters ── */
  const q       = filter.trim().toLowerCase();
  const visible = q ? convList.filter(c => c.name?.toLowerCase().includes(q)) : convList;
  const gList   = visible.filter(c => c.type === 'group');
  const dmList  = visible.filter(c => c.type === 'dm');

  const mq       = membFilter.trim().toLowerCase();
  const mVisible = mq
    ? clubMembers.filter(m => m.name?.toLowerCase().includes(mq) || m.club_name?.toLowerCase().includes(mq))
    : clubMembers;

  const totalUnread = convList.filter(c => c.type === 'dm').reduce((n, c) => n + (c.unread || 0), 0);

  const shellCls = `${s.shell} ${mobileShowChat ? s.chatOpen : ''}`;

  /* ══════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════ */
  return (
    <div className={shellCls}>

      {/* ══════════ SIDEBAR ══════════ */}
      <aside className={s.sidebar}>

        {composing ? (
          /* Compose new DM */
          <>
            <div className={s.sideHead}>
              <button className={s.iconBtn} onClick={() => { setComposing(false); setMembFilter(''); }}>
                <ArrowLeft />
              </button>
              <span className={s.sideTitle}>New Direct Message</span>
            </div>
            <div className={s.searchWrap}>
              <SearchIco />
              <input className={s.searchInput} placeholder="Search members…"
                value={membFilter} onChange={e => setMembFilter(e.target.value)} autoFocus />
            </div>
            <div className={s.convList}>
              {!membLoaded && <CentreSpinner />}
              {membLoaded && mVisible.length === 0 && (
                <div className={s.listEmpty}>
                  {membFilter ? 'No members match.' : 'No members found.'}
                </div>
              )}
              {mVisible.length > 0 && (
                <>
                  <div className={s.sectionLabel}>ALL MEMBERS</div>
                  {mVisible.map(member => (
                    <button key={member.id} className={s.convRow} onClick={() => startDM(member)}>
                      <UserAv src={avatarUrl(member.avatar)} name={member.name} size={44} />
                      <div className={s.convMeta}>
                        <div className={s.convTop}>
                          <span className={s.convName}>{member.name}</span>
                          {(member.role === 'coordinator' || member.role === 'admin') && (
                            <span className={s.roleBadge}>
                              {member.role === 'admin' ? 'Admin' : 'Coord'}
                            </span>
                          )}
                        </div>
                        <div className={s.convSub}>
                          {[member.club_name, member.dept].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          </>
        ) : (
          /* Conversation list */
          <>
            <div className={s.sideHead}>
              <span className={s.sideTitle}>Monitor Chats</span>
              <button className={s.iconBtn} title="New direct message"
                onClick={() => { setComposing(true); loadMembers(); }}>
                <ComposeIco />
              </button>
            </div>
            <div className={s.searchWrap}>
              <SearchIco />
              <input className={s.searchInput} placeholder="Search conversations…"
                value={filter} onChange={e => setFilter(e.target.value)} />
            </div>

            {/* Sub-tabs: Groups / DMs */}
            <div className={s.subTabs}>
              <button
                className={`${s.subTab} ${sideTab === 'groups' ? s.subTabOn : ''}`}
                onClick={() => setSideTab('groups')}>
                Club Chats
                {gList.length > 0 && <span className={s.subCount}>{gList.length}</span>}
              </button>
              <button
                className={`${s.subTab} ${sideTab === 'dms' ? s.subTabOn : ''}`}
                onClick={() => setSideTab('dms')}>
                Direct Messages
                {totalUnread > 0 && <span className={s.unreadPill}>{totalUnread > 99 ? '99+' : totalUnread}</span>}
              </button>
            </div>

            <div className={s.convList}>
              {!convsLoaded && <CentreSpinner />}

              {sideTab === 'groups' && (
                gList.length === 0
                  ? <div className={s.listEmpty}>{filter ? 'No clubs match.' : 'No clubs found.'}</div>
                  : gList.map(conv => (
                      <ConvRow key={conv.key} conv={conv}
                        active={activeConv?.type === 'group' && activeConv?.id === conv.id}
                        onClick={() => openConv(conv)} />
                    ))
              )}

              {sideTab === 'dms' && (
                <>
                  {dmList.length === 0
                    ? <div className={s.listEmpty}>
                        {filter ? 'No DMs match.' : 'No direct messages yet.\nClick compose to start one.'}
                      </div>
                    : dmList.map(conv => (
                        <ConvRow key={conv.key} conv={conv}
                          active={activeConv?.type === 'dm' && activeConv?.id === conv.id}
                          onClick={() => openConv(conv)} />
                      ))
                  }
                </>
              )}
            </div>
          </>
        )}
      </aside>

      {/* ══════════ CHAT PANEL ══════════ */}
      <main className={s.main}>
        {!activeConv ? (
          <div className={s.welcome}>
            <div className={s.welcomeIcon}>
              <svg viewBox="0 0 52 52" fill="none" width="52" height="52">
                <circle cx="26" cy="26" r="25" stroke={ACCENT} strokeWidth="2" opacity=".3"/>
                <path d="M16 26c0-5.52 4.48-10 10-10s10 4.48 10 10-4.48 10-10 10c-1.85 0-3.58-.51-5.07-1.38L16 36l1.38-4.93A9.96 9.96 0 0 1 16 26z"
                  fill={ACCENT} opacity=".9"/>
              </svg>
            </div>
            <div className={s.welcomeTitle}>Monitor Chats</div>
            <div className={s.welcomeSub}>
              Select a club group chat to monitor,<br/>or send a direct message to any member.
            </div>
            <button className={s.welcomeBtn} onClick={() => { setComposing(true); loadMembers(); }}>
              + New Direct Message
            </button>
          </div>
        ) : (
          <div className={s.chatPane}>

            {/* Chat header */}
            <div className={s.chatHead}>
              <button className={s.mobileBack} onClick={() => setMobileShowChat(false)}>
                <ArrowLeft />
              </button>

              {activeConv.type === 'group'
                ? <InitAv name={activeConv.name} color={activeConv.color} size={40} />
                : <UserAv src={avatarUrl(activeConv.avatarFile)} name={activeConv.name} color={ACCENT} size={40} />
              }

              <div className={s.chatHeadInfo}>
                <div className={s.chatHeadName}>{activeConv.name}</div>
                <div className={s.chatHeadSub}>
                  {activeConv.type === 'group' ? 'Club Group Chat' : 'Direct Message'}
                </div>
              </div>

              {activeConv.type === 'group' && (
                <span className={s.monitorBadge}>Monitoring</span>
              )}
            </div>

            {/* Messages */}
            <div className={s.chatBody}>
              {!msgsLoaded && <div className={s.chatLoading}><div className={s.spinner} /></div>}
              {msgsLoaded && messages.length === 0 && !chatErr && (
                <div className={s.chatEmpty}>
                  <span>💬</span>
                  <p>No messages yet in this conversation.</p>
                </div>
              )}

              {messages.map((msg, i) => {
                const me      = isMe(msg);
                const prev    = messages[i - 1];
                const grouped = !!prev && isMe(prev) === me
                  && (new Date(msg.created_at) - new Date(prev.created_at)) < 300000;
                const newDay  = i === 0
                  || new Date(msg.created_at).toDateString() !== new Date(messages[i - 1].created_at).toDateString();

                return (
                  <div key={msg.id}>
                    {newDay && (
                      <div className={s.daySep}><span>{dayLabel(msg.created_at)}</span></div>
                    )}
                    <div className={`${s.msgRow} ${me ? s.me : ''} ${grouped ? s.grouped : ''}`}>
                      {!me && activeConv.type === 'group' && (
                        <div className={s.msgAv}>
                          {!grouped
                            ? <UserAv src={avatarUrl(senderAvFile(msg))} name={senderName(msg)} color={activeConv.color} size={32} />
                            : <div style={{ width: 32 }} />}
                        </div>
                      )}
                      <div className={s.msgCol}>
                        {!grouped && !me && activeConv.type === 'group' && (
                          <div className={s.senderName} style={{ color: activeConv.color }}
                            onClick={() => msg.user_id && msg.user_id !== user?.id && startDM({
                              id: msg.user_id, name: msg.user_name, avatar: msg.user_avatar,
                            })}>
                            {senderName(msg)}
                            {msg.user_role === 'coordinator' && <span className={s.roleBadge}>Coordinator</span>}
                            {msg.user_role === 'admin'       && <span className={s.roleBadge} style={{ background:'#fef3c7', color:'#d97706' }}>Admin</span>}
                          </div>
                        )}
                        <div className={`${s.bubble} ${me ? s.bubbleMe : s.bubbleOther} ${msg._pending ? s.bubblePending : ''}`}>
                          {msg.content}
                          <span className={s.ts}>
                            {msg._pending ? '…' : msgTimeFmt(msg.created_at)}
                            {me && !msg._pending && activeConv.type === 'dm' && (
                              <span className={`${s.tick} ${msg.read_at ? s.tickRead : ''}`}>
                                {msg.read_at ? ' ✓✓' : ' ✓'}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {chatErr && <div className={s.chatErr}>{chatErr}</div>}

            {/* Input */}
            <form className={s.inputBar} onSubmit={handleSend}>
              <input
                ref={inputRef}
                className={s.inputField}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                placeholder={activeConv.type === 'group' ? 'Send a message to this club…' : 'Type a message…'}
                maxLength={2000}
                disabled={sending}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
                }}
              />
              <button className={s.sendBtn} type="submit"
                disabled={!chatInput.trim() || sending} aria-label="Send">
                {sending
                  ? <div className={s.spinnerSm} />
                  : <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                    </svg>
                }
              </button>
            </form>

          </div>
        )}
      </main>
    </div>
  );
}

/* ── Conversation row ── */
function ConvRow({ conv, active, onClick }) {
  return (
    <button className={`${s.convRow} ${active ? s.convRowActive : ''} ${conv.unread > 0 && !active ? s.convRowUnread : ''}`}
      onClick={onClick}>
      <UserAv src={conv.avatarFile ? avatarUrl(conv.avatarFile) : ''} name={conv.name} color={conv.color} size={46} />
      <div className={s.convMeta}>
        <div className={s.convTop}>
          <span className={`${s.convName} ${conv.unread > 0 && !active ? s.convNameUnread : ''}`}>{conv.name}</span>
          {conv.lastAt && <span className={s.convTime}>{convTime(conv.lastAt)}</span>}
        </div>
        <div className={s.convBottom}>
          <div className={s.convSub}>
            {conv.lastMsg
              ? <>{conv.type === 'group' && conv.lastSender ? <b>{conv.lastSender}: </b> : ''}{conv.lastMsg}</>
              : <em>No messages yet</em>}
          </div>
          {conv.unread > 0 && !active && (
            <span className={s.unreadBadge}>{conv.unread > 99 ? '99+' : conv.unread}</span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ── Icon helpers ── */
function CentreSpinner() {
  return <div className={s.centreSpinner}><div className={s.spinner} /></div>;
}
function SearchIco() {
  return (
    <svg className={s.searchIco} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
  );
}
function ArrowLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="20" height="20">
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
