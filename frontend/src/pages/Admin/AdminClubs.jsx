import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import ProposalDetails from './ProposalDetails';
import { formatDate } from './proposalUtils';
import s from './AdminClubs.module.css';

const CATS = ['sports', 'cultural', 'social', 'academic'];
const CAT_LABELS = { sports: 'Sports', cultural: 'Cultural', social: 'Social', academic: 'Academic' };
const CAT_COLORS = { sports: '#ff4757', cultural: '#ff6b9d', social: '#06d6a0', academic: '#635bff' };

const EMPTY = {
  name: '', category: 'academic', color: '#635BFF',
  coordinator: '', foundedYear: '', memberCount: 0, eventCount: 0, description: '',
  /* Optional — assign the club's Faculty Coordinator and/or Student Coordinator
     in the same step as creating the club, through the same account
     creation-or-reuse + credentials-email flow the dedicated Assign modals use.
     Only ever sent (and only ever shown) while adding a new club — editing an
     existing one goes through Assign FC / Assign Coordinator on its card instead. */
  fcName: '', fcEmail: '', scName: '', scEmail: '',
};

/* ── Club Card (admin view) ── */
function ClubCard({ club, onEdit, onDelete, onViewRequests, onViewMembers, onAssignCoord, onAssignFC, onViewLeadership }) {
  const accent = club.color || CAT_COLORS[club.category] || '#635bff';
  const logoSrc = club.logoUrl || (club.logo ? `/logos/${club.logo}` : null);
  const [linkCopied, setLinkCopied] = useState(false);
  const copyLink = () => {
    const url = `${window.location.origin}/clubs/${club._id}`;
    navigator.clipboard?.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    }).catch(() => {});
  };

  return (
    <div className={s.card}>
      <div className={s.cardHeader} style={{ background: accent + '14', borderBottom: `2px solid ${accent}25` }}>
        <span className={s.cardCat} style={{ background: accent + '18', color: accent }}>
          {CAT_LABELS[club.category] || club.category}
        </span>
        <div className={s.cardLogo}>
          {logoSrc ? (
            <img
              src={logoSrc}
              alt={club.name}
              loading="lazy"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
            />
          ) : null}
          <div className={s.cardLogoFallback} style={{ background: accent + '20', color: accent, display: logoSrc ? 'none' : 'flex' }}>
            {club.name?.[0]}
          </div>
        </div>
      </div>
      <div className={s.cardBody}>
        <div className={s.cardName}>{club.name}</div>

        {/* Faculty Coordinator row — senior staff, assigned by admin only */}
        <div className={s.coordRow}>
          <div className={s.coordInfo}>
            <span className={s.coordRoleTag}>FC</span>
            <span className={club.facultyCoordinator ? s.coordName : s.coordEmpty}>
              {club.facultyCoordinator || 'No Faculty Coordinator assigned'}
            </span>
          </div>
          <button
            className={s.assignCoordBtn}
            onClick={() => onAssignFC(club)}
            title={club.facultyCoordinator ? 'Change Faculty Coordinator' : 'Assign Faculty Coordinator'}
          >
            {club.facultyCoordinator ? 'Change' : '+ Assign'}
          </button>
        </div>

        {/* Student Coordinator row — day-to-day operations, assigned by admin
            or by this club's own Faculty Coordinator */}
        <div className={s.coordRow}>
          <div className={s.coordInfo}>
            <span className={s.coordRoleTag}>SC</span>
            <span className={club.coordinator ? s.coordName : s.coordEmpty}>
              {club.coordinator || 'No Student Coordinator assigned'}
            </span>
          </div>
          <button
            className={s.assignCoordBtn}
            onClick={() => onAssignCoord(club)}
            title={club.coordinator ? 'Change Student Coordinator' : 'Assign Student Coordinator'}
          >
            {club.coordinator ? 'Change' : '+ Assign'}
          </button>
        </div>

        {club.foundedYear && (
          <div className={s.cardMeta}>Est. {club.foundedYear}</div>
        )}
        {club.description && <div className={s.cardDesc}>{club.description}</div>}
        <div className={s.cardStats}>
          <span style={{ color: '#635bff' }}>Members: {club.memberCount ?? 0}</span>
          <span style={{ color: '#00c896' }}>Events: {club.eventCount ?? 0}</span>
        </div>
      </div>
      <div className={s.cardActions}>
        <button className={s.reqsBtn}   onClick={() => onViewRequests(club)}>Requests</button>
        <button className={s.membsBtn}  onClick={() => onViewMembers(club)}>Members</button>
      </div>
      <div className={s.cardActions} style={{ borderTop: 'none', paddingTop: 0 }}>
        <button className={s.membsBtn} onClick={copyLink} style={{ width: '100%' }} title="Copy a direct link students can use to join this club">
          {linkCopied ? 'Link copied ✓' : '🔗 Copy Join Link'}
        </button>
      </div>
      <div className={s.cardActions} style={{ borderTop: 'none', paddingTop: 0 }}>
        <button className={s.leaderBtn} onClick={() => onViewLeadership(club)} style={{ width: '100%' }}>
          👑 Leadership
        </button>
      </div>
      <div className={s.cardActions} style={{ borderTop: 'none', paddingTop: 0 }}>
        <button className={s.editBtn} onClick={() => onEdit(club)}>Edit</button>
        <button className={s.delBtn}  onClick={() => onDelete(club._id)}>Delete</button>
      </div>
    </div>
  );
}

/* ══ Main AdminClubs ══ */
export default function AdminClubs() {
  const [clubs,       setClubs]      = useState([]);
  const [loading,     setLoading]    = useState(true);
  const [search,      setSearch]     = useState('');
  const [catFilter,   setCatFilter]  = useState('all');
  const [modal,       setModal]      = useState(false);  // false | 'add' | 'edit'
  const [form,        setForm]       = useState(EMPTY);
  const [editingId,   setEditingId]  = useState(null);
  const [logoFile,    setLogoFile]   = useState(null);
  const [logoPreview, setLogoPreview]= useState('');
  const [saving,      setSaving]     = useState(false);
  const [deleteId,    setDeleteId]   = useState(null);
  const [error,       setError]      = useState('');
  const [seeding,     setSeeding]    = useState(false);
  const [creds,       setCreds]      = useState(null); // { name, email, password }
  const [credsQueue,  setCredsQueue] = useState([]); // remaining creds to show, when a club is created with both FC and SC at once
  const showCredsQueue = (list) => {
    const [first, ...rest] = list;
    setCreds(first || null);
    setCredsQueue(rest);
  };
  const closeCreds = () => {
    if (credsQueue.length) showCredsQueue(credsQueue);
    else setCreds(null);
  };
  /* ── Assign Coordinator ── */
  const [coordClub,   setCoordClub]  = useState(null); // club being assigned
  const [coordName,   setCoordName]  = useState('');
  const [coordEmail,  setCoordEmail] = useState('');
  const [coordSaving, setCoordSaving]= useState(false);
  const [coordError,  setCoordError] = useState('');
  const [coordAssignments, setCoordAssignments] = useState([]); // existing clubs for this email
  const [coordLookingUp,   setCoordLookingUp]   = useState(false);
  const [coordLookupUser,  setCoordLookupUser]  = useState(null); // { id, name, email } if exists
  /* ── Assign Faculty Coordinator — same shape, one tier above Coordinator ── */
  const [fcClub,   setFcClub]   = useState(null);
  const [fcName,   setFcName]   = useState('');
  const [fcEmail,  setFcEmail]  = useState('');
  const [fcSaving, setFcSaving] = useState(false);
  const [fcError,  setFcError]  = useState('');
  const [fcAssignments, setFcAssignments] = useState([]);
  const [fcLookingUp,   setFcLookingUp]   = useState(false);
  /* ── Requests panel ── */
  const [reqClub,     setReqClub]    = useState(null);
  const [requests,    setRequests]   = useState([]);
  const [reqLoading,  setReqLoading] = useState(false);
  const [reqFilter,   setReqFilter]  = useState('all');
  const [actionId,    setActionId]   = useState(null);
  /* ── Members panel ── */
  const [membClub,    setMembClub]   = useState(null);
  const [members,     setMembers]    = useState([]);
  const [membLoading, setMembLoading]= useState(false);
  const [membSearch,  setMembSearch] = useState('');
  /* ── Leadership panel ── */
  const [leaderClub,    setLeaderClub]    = useState(null);
  const [leaderItems,   setLeaderItems]   = useState([]);
  const [leaderLoading, setLeaderLoading] = useState(false);
  const fileRef = useRef();

  const load = () => {
    setLoading(true);
    api.get('/clubs')
      .then(d => setClubs(d.clubs || []))
      .catch(() => setError('Failed to load clubs. Check that the backend server is running.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openAdd = () => {
    setForm(EMPTY); setEditingId(null); setLogoFile(null); setLogoPreview(''); setError('');
    setModal('add');
  };
  const openEdit = (club) => {
    setForm({
      name: club.name, category: club.category, color: club.color || '#635BFF',
      coordinator: club.coordinator || '', foundedYear: club.foundedYear || '',
      memberCount: club.memberCount ?? 0, eventCount: club.eventCount ?? 0,
      description: club.description || '',
    });
    setEditingId(club._id);
    setLogoPreview(club.logoUrl || (club.logo ? `/logos/${club.logo}` : ''));
    setLogoFile(null);
    setError('');
    setModal('edit');
  };
  /* ── Creating a club from a proposal (Approvals → "Review & Create") ──
     /admin/clubs?proposal=<id> opens the Add form pre-filled from what the
     proposer submitted, so admin can add the logo, verify and correct
     everything, and create the club — which also approves the proposal. */
  const [searchParams, setSearchParams] = useSearchParams();
  const proposalParam = searchParams.get('proposal');
  const [proposal,     setProposal]     = useState(null);
  const [showApp,      setShowApp]      = useState(true);
  const [notice,       setNotice]       = useState('');

  const clearProposal = () => {
    setProposal(null);
    if (searchParams.has('proposal')) {
      searchParams.delete('proposal');
      setSearchParams(searchParams, { replace: true });
    }
  };

  useEffect(() => {
    if (!proposalParam) return;
    api.get(`/club-proposals/${proposalParam}`)
      .then(({ proposal: p }) => {
        if (p.status !== 'pending') {
          setError(`The proposal for "${p.club_name}" was already ${p.status}.`);
          clearProposal();
          return;
        }
        const d = p.details || {};
        setForm({
          ...EMPTY,
          name:        p.club_name || '',
          category:    CATS.includes(p.category) ? p.category : 'academic',
          color:       p.color || '#635BFF',
          description: p.description || '',
          foundedYear: p.founded_year || String(new Date().getFullYear()),
          coordinator: d.advisor?.Name || '',
          vision:      p.vision || '',
          schedule:    p.schedule || '',
          rules:       (p.rules || []).join('\n'),
          tags:        JSON.stringify(p.tags || []),
          fcName:      d.advisor?.Name || '',
          fcEmail:     d.advisor?.Email || '',
          scName:      d.coordinator?.Name || '',
          scEmail:     d.coordinator?.Email || '',
          proposalId:  String(p.id),
        });
        setProposal(p);
        setShowApp(true);
        setEditingId(null); setLogoFile(null); setLogoPreview(''); setError('');
        setModal('add');
      })
      .catch(err => { setError(err.message); clearProposal(); });
  }, [proposalParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeModal = () => {
    setModal(false); setLogoFile(null); setLogoPreview(''); setError('');
    if (proposal) clearProposal();
  };

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Club name is required.');
    if (modal === 'add') {
      if (form.fcEmail.trim() && !form.fcName.trim()) return setError('Faculty Coordinator name is required if an email is given.');
      if (form.scEmail.trim() && !form.scName.trim()) return setError('Student Coordinator name is required if an email is given.');
      if (form.fcEmail.trim() && !form.fcEmail.toLowerCase().endsWith('@rku.ac.in')) return setError('Faculty Coordinator email must be an @rku.ac.in address.');
      if (form.scEmail.trim() && !form.scEmail.toLowerCase().endsWith('@rku.ac.in')) return setError('Student Coordinator email must be an @rku.ac.in address.');
    }
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (logoFile) fd.append('logo', logoFile);
      if (modal === 'add') {
        const res = await api.postForm('/clubs', fd);
        /* Surface whichever FC/SC assignments were requested — a failed one
           (bad email, name missing) never blocks the club itself, which by
           now already exists, so report it as a plain warning instead. */
        const failures = [res.fc, res.sc].filter(r => r && !r.ok).map(r => r.message);
        if (failures.length) alert(`Club created, but: ${failures.join(' ')} You can assign this from the club's card.`);
        const queued = [res.fc, res.sc]
          .filter(r => r?.ok && r.credentials)
          .map(r => ({ ...r.credentials, emailSent: r.emailSent, emailPending: r.emailPending, roleLabel: r === res.fc ? 'Faculty Coordinator' : 'Student Coordinator' }));
        if (queued.length) showCredsQueue(queued);
        if (proposal) {
          setNotice(`"${res.club?.name || form.name}" created and the proposal approved${proposal.proposed_by_id ? ` — ${proposal.proposed_by_name} has been notified` : ''}.`);
          setTimeout(() => setNotice(''), 6000);
          window.dispatchEvent(new Event('soac:approvals-changed'));
        }
      } else {
        await api.putForm(`/clubs/${editingId}`, fd);
      }
      closeModal();
      load();
    } catch (err) {
      /* The club already exists for this proposal (e.g. created in another tab
         or by another admin) — nothing left to do here, so close and show it. */
      if (proposal && /already approved/i.test(err.message)) {
        closeModal();
        load();
        setNotice(err.message);
        setTimeout(() => setNotice(''), 8000);
        window.dispatchEvent(new Event('soac:approvals-changed'));
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/clubs/${deleteId}`);
      setDeleteId(null);
      load();
    } catch (err) { setError(err.message); }
  };

  const handleSeed = async () => {
    setSeeding(true); setError('');
    try {
      const d = await api.post('/clubs/seed');
      setError('');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSeeding(false);
    }
  };

  const sf = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));

  /* ── Assign Coordinator ── */
  const openAssignCoord = (club) => {
    setCoordClub(club);
    setCoordName(club.coordinator || '');
    setCoordEmail('');
    setCoordError('');
    setCoordAssignments([]);
    setCoordLookingUp(false);
    setCoordLookupUser(null);
  };
  const closeAssignCoord = () => {
    setCoordClub(null); setCoordName(''); setCoordEmail(''); setCoordError('');
    setCoordAssignments([]); setCoordLookupUser(null);
  };

  const handleCoordEmailLookup = async (email) => {
    const e = email.trim().toLowerCase();
    if (!e.endsWith('@rku.ac.in')) { setCoordAssignments([]); setCoordLookupUser(null); return; }
    setCoordLookingUp(true);
    try {
      const d = await api.get(`/clubs/coordinator-assignments?email=${encodeURIComponent(e)}`);
      setCoordAssignments(d.assignments || []);
      setCoordLookupUser(d.user || null);
      if (d.user?.name && !coordName) setCoordName(d.user.name);
    } catch (_) {
      setCoordAssignments([]); setCoordLookupUser(null);
    } finally {
      setCoordLookingUp(false);
    }
  };

  const handleAssignCoord = async (e) => {
    e.preventDefault();
    if (!coordName.trim()) return setCoordError('Coordinator name is required.');
    if (!coordEmail.trim()) return setCoordError('RKU email is required.');
    if (!coordEmail.toLowerCase().endsWith('@rku.ac.in')) return setCoordError('Only @rku.ac.in emails are allowed.');
    setCoordSaving(true); setCoordError('');
    try {
      const res = await api.post(`/clubs/${coordClub._id}/assign-coordinator`, {
        name: coordName.trim(), email: coordEmail.trim(),
      });
      closeAssignCoord();
      load();
      if (res.credentials) setCreds({ ...res.credentials, emailSent: res.emailSent, emailPending: res.emailPending, roleLabel: 'Student Coordinator' });
    } catch (err) {
      setCoordError(err.message || 'Failed to assign coordinator.');
    } finally {
      setCoordSaving(false);
    }
  };

  /* ── Assign Faculty Coordinator — mirrors Assign Coordinator above, posting
     to /clubs/:id/assign-fc instead, one tier above the Student Coordinator. ── */
  const openAssignFC = (club) => {
    setFcClub(club);
    setFcName(club.facultyCoordinator || '');
    setFcEmail('');
    setFcError('');
    setFcAssignments([]);
    setFcLookingUp(false);
  };
  const closeAssignFC = () => {
    setFcClub(null); setFcName(''); setFcEmail(''); setFcError(''); setFcAssignments([]);
  };

  const handleFcEmailLookup = async (email) => {
    const e = email.trim().toLowerCase();
    if (!e.endsWith('@rku.ac.in')) { setFcAssignments([]); return; }
    setFcLookingUp(true);
    try {
      const d = await api.get(`/clubs/coordinator-assignments?email=${encodeURIComponent(e)}`);
      setFcAssignments(d.assignments || []);
      if (d.user?.name && !fcName) setFcName(d.user.name);
    } catch {
      setFcAssignments([]);
    } finally {
      setFcLookingUp(false);
    }
  };

  const handleAssignFC = async (e) => {
    e.preventDefault();
    if (!fcName.trim()) return setFcError('Faculty Coordinator name is required.');
    if (!fcEmail.trim()) return setFcError('RKU email is required.');
    if (!fcEmail.toLowerCase().endsWith('@rku.ac.in')) return setFcError('Only @rku.ac.in emails are allowed.');
    setFcSaving(true); setFcError('');
    try {
      const res = await api.post(`/clubs/${fcClub._id}/assign-fc`, {
        name: fcName.trim(), email: fcEmail.trim(),
      });
      closeAssignFC();
      load();
      if (res.credentials) setCreds({ ...res.credentials, emailSent: res.emailSent, emailPending: res.emailPending, roleLabel: 'Faculty Coordinator', isPromotion: res.isPromotion });
    } catch (err) {
      setFcError(err.message || 'Failed to assign Faculty Coordinator.');
    } finally {
      setFcSaving(false);
    }
  };

  /* ── Requests panel ── */
  const viewRequests = (club) => {
    setReqClub(club);
    setRequests([]);
    setReqFilter('all');
    setReqLoading(true);
    api.get(`/requests?clubId=${club._id}`)
      .then(d => setRequests(d.requests || []))
      .catch(() => setRequests([]))
      .finally(() => setReqLoading(false));
  };

  const handleApprove = async (reqId) => {
    setActionId(reqId);
    try {
      const res = await api.post(`/requests/${reqId}/approve`, {});
      setRequests(p => p.map(r => r._id === reqId ? { ...r, status: 'approved' } : r));
      if (res.newAccount && res.credentials) setCreds({ ...res.credentials, emailSent: res.emailSent });
      load(); // refresh member counts
    } catch (err) {
      alert(err.message);
    } finally { setActionId(null); }
  };

  const handleDecline = async (reqId) => {
    setActionId(reqId);
    try {
      await api.post(`/requests/${reqId}/decline`, {});
      setRequests(p => p.map(r => r._id === reqId ? { ...r, status: 'declined' } : r));
    } catch (err) {
      alert(err.message);
    } finally { setActionId(null); }
  };

  const exportReqsCSV = () => {
    if (!requests.length) return;
    const headers = ['#', 'Name', 'Email', 'Enrollment No', 'Dept', 'Year', 'Message', 'Status', 'Submitted At'];
    const rows = requests.map((r, i) => [
      i + 1, `"${r.name}"`, r.email, r.enrollmentNo || '', r.dept || '', r.year || '',
      `"${(r.message || '').replace(/"/g, "'")}"`, r.status,
      r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN') : '',
    ]);
    const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `${reqClub?.name}_requests.csv` });
    a.click(); URL.revokeObjectURL(url);
  };

  /* ── Leadership panel ── */
  const viewLeadership = (club) => {
    setLeaderClub(club);
    setLeaderItems([]);
    setLeaderLoading(true);
    api.get(`/clubs/${club._id}/leadership`)
      .then(d => setLeaderItems(d.leadership || []))
      .catch(() => setLeaderItems([]))
      .finally(() => setLeaderLoading(false));
  };

  /* ── Members panel ── */
  const viewMembers = (club) => {
    setMembClub(club);
    setMembers([]);
    setMembSearch('');
    setMembLoading(true);
    api.get(`/clubs/${club._id}/members`)
      .then(d => setMembers(d.members || []))
      .catch(() => setMembers([]))
      .finally(() => setMembLoading(false));
  };

  const exportMembsCSV = () => {
    if (!members.length) return;
    const headers = ['#', 'Name', 'Email', 'Dept', 'Year', 'Joined At'];
    const rows = members.map((m, i) => [
      i + 1, `"${m.name}"`, m.email, m.dept || '', m.year || '',
      m.joined_at ? new Date(m.joined_at).toLocaleString('en-IN') : '',
    ]);
    const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: `${membClub?.name}_members.csv` });
    a.click(); URL.revokeObjectURL(url);
  };

  const filteredReqs  = requests.filter(r => reqFilter === 'all' || r.status === reqFilter);
  const filteredMembs = members.filter(m =>
    !membSearch || m.name?.toLowerCase().includes(membSearch.toLowerCase())
               || m.email?.toLowerCase().includes(membSearch.toLowerCase())
               || m.dept?.toLowerCase().includes(membSearch.toLowerCase())
  );

  const reqCounts = { pending: 0, approved: 0, declined: 0 };
  requests.forEach(r => { if (reqCounts[r.status] !== undefined) reqCounts[r.status]++; });

  const filtered = clubs.filter(c => {
    const okCat  = catFilter === 'all' || c.category === catFilter;
    const okName = !search || c.name.toLowerCase().includes(search.toLowerCase())
                           || c.coordinator?.toLowerCase().includes(search.toLowerCase());
    return okCat && okName;
  });

  return (
    <div className={s.page}>

      {/* ── Credentials modal ── */}
      {creds && (
        <div style={{
          position:'fixed', inset:0, zIndex:10000,
          background:'rgba(15,10,46,.6)', backdropFilter:'blur(4px)',
          display:'flex', alignItems:'center', justifyContent:'center', padding:20,
        }}>
          <div style={{
            background:'#fff', borderRadius:18, padding:28, maxWidth:460, width:'100%',
            boxShadow:'0 24px 64px rgba(0,0,0,.22)',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <div>
                <div style={{ fontFamily:'Plus Jakarta Sans,sans-serif', fontWeight:900, fontSize:16, color:'#0f0a2e' }}>
                  {creds.isPromotion ? 'Promoted to Faculty Coordinator!' : creds.password ? 'Account Created!' : `${creds.roleLabel || 'Coordinator'} Assigned!`}
                </div>
                <div style={{ fontSize:13, color:'#6b7280', marginTop:2 }}>
                  {creds.isPromotion
                    ? <><strong>{creds.name}</strong> is now Faculty Coordinator of <strong>{creds.clubName}</strong> — their Student Coordinator access (on every club) has been revoked, and a new password was issued below.</>
                    : creds.password
                    ? <>Credentials for <strong>{creds.name}</strong> — send them this or they'll receive an email.</>
                    : <><strong>{creds.name}</strong> has been added as {(creds.roleLabel || "Coordinator").toLowerCase()} of <strong>{creds.clubName}</strong>.</>}
                </div>
              </div>
            </div>

            {creds.password ? (
              /* ── New user: show full credentials ── */
              <>
                <div style={{
                  background:'#f8f7ff', border:'1.5px solid #e0deff',
                  borderRadius:12, padding:'16px 18px', marginBottom:16,
                }}>
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:'#9ca3af', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>Login URL</div>
                    <div style={{ fontWeight:700, color:'#635BFF', fontSize:13 }}>{window.location.origin}/login</div>
                  </div>
                  <div style={{ marginBottom:12 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:'#9ca3af', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>Email</div>
                    <div style={{ fontWeight:700, color:'#0f0a2e', fontSize:14, fontFamily:'monospace' }}>{creds.email}</div>
                  </div>
                  {creds.clubName && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize:10, fontWeight:800, color:'#9ca3af', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>Club</div>
                      <div style={{ fontWeight:700, color:'#0f0a2e', fontSize:14 }}>{creds.clubName}</div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize:10, fontWeight:800, color:'#9ca3af', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>Temporary Password</div>
                    <div style={{
                      fontWeight:900, color:'#D32F2F', fontSize:22, letterSpacing:4,
                      fontFamily:'monospace', background:'#fff', borderRadius:4,
                      padding:'8px 12px', border:'1.5px dashed #fca5a5', display:'inline-block',
                    }}>{creds.password}</div>
                  </div>
                </div>
                {creds.emailSent === false ? (
                  <div style={{
                    background:'#fff7ed', border:'1.5px solid #fb923c',
                    borderRadius:8, padding:'12px 14px', marginBottom:18,
                    fontSize:12, color:'#9a3412', lineHeight:1.7,
                  }}>
                    <strong>Email could not be sent.</strong> Share these credentials with the coordinator directly.
                    They must change their password after first login.
                  </div>
                ) : (
                  <div style={{
                    background:'#fffbeb', border:'1px solid #fcd34d',
                    borderRadius:4, padding:'10px 14px', marginBottom:18,
                    fontSize:12, color:'#92400e', lineHeight:1.6,
                  }}>
                    {creds.emailPending
                      ? <>A credentials email is being sent to <strong>{creds.email}</strong> — this can take a minute. Note the password above in case it doesn't arrive.</>
                      : <>A credentials email was sent to <strong>{creds.email}</strong>.</>}
                    {' '}They should change their password on first login.
                  </div>
                )}
              </>
            ) : (
              /* ── Existing user: confirmation only, no password shown ── */
              <>
                <div style={{
                  background:'#f0fff8', border:'1.5px solid #86efac',
                  borderRadius:12, padding:'18px 20px', marginBottom:16, textAlign:'center',
                }}>
                  <div style={{ fontSize:28, marginBottom:8 }}>✓</div>
                  <div style={{ fontWeight:800, color:'#15803d', fontSize:15 }}>Club access granted</div>
                  <div style={{ fontSize:13, color:'#555', marginTop:6, lineHeight:1.6 }}>
                    <strong>{creds.name}</strong> can now manage <strong>{creds.clubName}</strong>.<br />
                    Their existing credentials are unchanged — no password reset.
                  </div>
                </div>
                {creds.emailSent === false ? (
                  <div style={{
                    background:'#fff7ed', border:'1.5px solid #fb923c',
                    borderRadius:8, padding:'12px 14px', marginBottom:18,
                    fontSize:12, color:'#9a3412', lineHeight:1.7,
                  }}>
                    <strong>Notification email could not be sent.</strong> Inform {creds.name} manually that they now manage <strong>{creds.clubName}</strong>.
                  </div>
                ) : (
                  <div style={{
                    background:'#eff6ff', border:'1px solid #bfdbfe',
                    borderRadius:4, padding:'10px 14px', marginBottom:18,
                    fontSize:12, color:'#1e40af', lineHeight:1.6,
                  }}>
                    A confirmation email {creds.emailPending ? 'is being sent' : 'was sent'} to <strong>{creds.email}</strong> notifying them of the new club assignment.
                  </div>
                )}
              </>
            )}

            <button
              onClick={closeCreds}
              style={{
                width:'100%', padding:11, borderRadius:4, border:'none',
                background:'#635BFF', color:'#fff', fontWeight:800,
                fontSize:14, cursor:'pointer', fontFamily:'DM Sans,sans-serif',
              }}
            >Got it, close</button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className={s.header}>
        <div>
          <h1 className={s.title}>All Clubs</h1>
          <p className={s.sub}>
            {loading ? 'Loading…' : `${clubs.length} clubs · ${filtered.length} shown · Changes reflect on the guest site instantly`}
          </p>
        </div>
        <button className={s.addBtn} onClick={openAdd}>+ Add Club</button>
      </div>

      {/* ── Search ── */}
      <div className={s.searchRow}>
        <div className={s.searchWrap}>
          <svg className={s.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className={s.searchInput}
            placeholder="Search clubs or coordinators…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Category tabs — horizontally scrollable, no scrollbar ── */}
      <div className={s.catTabsScroll}>
        <div className={s.catTabs}>
          {['all', ...CATS].map(c => (
            <button
              key={c}
              className={`${s.catTab} ${catFilter === c ? s.catTabOn : ''}`}
              style={catFilter === c && c !== 'all' ? { background: CAT_COLORS[c] + '18', color: CAT_COLORS[c], borderColor: CAT_COLORS[c] + '44' } : {}}
              onClick={() => setCatFilter(c)}
            >
              {c === 'all' ? 'All' : CAT_LABELS[c]}
              {c !== 'all' && ` (${clubs.filter(cl => cl.category === c).length})`}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      {error && !modal && <div className={s.errorBar}>{error}</div>}
      {notice && (
        <div className={s.errorBar} style={{ background:'#f0fdf4', borderColor:'#bbf7d0', color:'#15803d' }}>
          ✓ {notice}
        </div>
      )}

      {loading ? (
        <div className={s.grid}>
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className={s.skeleton} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className={s.empty}>
          <p>{clubs.length === 0 ? 'No clubs in database' : 'No clubs found'}</p>
          {clubs.length === 0 ? (
            <span>
              <button className={s.seedBtn} onClick={handleSeed} disabled={seeding}>
                {seeding ? 'Seeding…' : 'Seed all 40 default clubs'}
              </button>
              {' or '}
              <button onClick={openAdd}>add one manually</button>
            </span>
          ) : (
            <span>Try a different filter or <button onClick={openAdd}>add a new club</button></span>
          )}
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map(club => (
            <ClubCard key={club._id} club={club} onEdit={openEdit} onDelete={setDeleteId}
              onViewRequests={viewRequests} onViewMembers={viewMembers}
              onAssignCoord={openAssignCoord} onAssignFC={openAssignFC} onViewLeadership={viewLeadership} />
          ))}
        </div>
      )}

      {/* ══ Assign Student Coordinator Modal ══ */}
      {coordClub && (
        <div className={s.overlay} onClick={closeAssignCoord}>
          <div className={s.modal} style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className={s.modalHeader}>
              <div>
                <div className={s.modalTag}>Student Coordinator Assignment</div>
                <h2 className={s.modalTitle}>{coordClub.name}</h2>
              </div>
              <button className={s.closeBtn} onClick={closeAssignCoord}>✕</button>
            </div>

            {/* Current coordinator banner */}
            {coordClub.coordinator && (
              <div style={{
                margin: '0 24px 20px', padding: '10px 14px',
                background: '#f0f9ff', border: '1px solid #bae6fd',
                borderRadius: 4, fontSize: 13, color: '#0369a1',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>Currently assigned: <strong>{coordClub.coordinator}</strong></span>
              </div>
            )}

            <form onSubmit={handleAssignCoord} className={s.form}>
              <div className={s.field}>
                <label>
                  Student Coordinator Full Name <span className={s.req}>*</span>
                </label>
                <input
                  value={coordName}
                  onChange={e => setCoordName(e.target.value)}
                  placeholder="e.g. Prof. Anita Mehta"
                  required
                />
              </div>

              <div className={s.field}>
                <label>
                  RKU Email Address <span className={s.req}>*</span>
                </label>
                <input
                  type="email"
                  value={coordEmail}
                  onChange={e => { setCoordEmail(e.target.value); setCoordAssignments([]); setCoordLookupUser(null); }}
                  onBlur={e => handleCoordEmailLookup(e.target.value)}
                  placeholder="coordinator@rku.ac.in"
                  required
                />
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  If this email doesn't exist yet, a new account will be created and credentials emailed to them.
                  If it already exists, they'll receive a <strong>confirmation email only</strong> — their password won't be changed.
                </div>
              </div>

              {/* Existing clubs managed by this email */}
              {(coordLookingUp || coordAssignments.length > 0) && (
                <div style={{
                  padding: '10px 13px', borderRadius: 4,
                  background: '#f0f9ff', border: '1px solid #bae6fd',
                  fontSize: 13,
                }}>
                  {coordLookingUp ? (
                    <span style={{ color: '#0369a1' }}>Looking up coordinator…</span>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, color: '#0369a1', marginBottom: 6 }}>
                        Already managing {coordAssignments.length} club{coordAssignments.length !== 1 ? 's' : ''}:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {coordAssignments.map(a => (
                          <span key={a.id} style={{
                            padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                            background: a.is_active ? '#00c89618' : '#f3f4f6',
                            color: a.is_active ? '#007a5e' : '#9ca3af',
                            border: `1px solid ${a.is_active ? '#00c89640' : '#e5e7eb'}`,
                          }}>
                            {a.club_name}{!a.is_active ? ' (inactive)' : ''}
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
                        Assigning to <strong>{coordClub?.name}</strong> will add the club to their dashboard. If they're a new user, a temporary password will be set.
                      </div>
                    </>
                  )}
                </div>
              )}

              {coordError && (
                <div style={{
                  padding: '10px 13px', borderRadius: 4,
                  background: '#fff0f0', border: '1px solid #fca5a5',
                  color: '#b91c1c', fontSize: 13,
                }}>{coordError}</div>
              )}

              <div className={s.modalFooter}>
                <button type="button" className={s.cancelBtn} onClick={closeAssignCoord}>Cancel</button>
                <button type="submit" className={s.saveBtn} disabled={coordSaving}>
                  {coordSaving ? 'Assigning…' : 'Assign Student Coordinator'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ Assign Faculty Coordinator Modal — same procedure, one tier up ══ */}
      {fcClub && (
        <div className={s.overlay} onClick={closeAssignFC}>
          <div className={s.modal} style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <div>
                <div className={s.modalTag}>Faculty Coordinator Assignment</div>
                <h2 className={s.modalTitle}>{fcClub.name}</h2>
              </div>
              <button className={s.closeBtn} onClick={closeAssignFC}>✕</button>
            </div>

            {fcClub.facultyCoordinator && (
              <div style={{
                margin: '0 24px 20px', padding: '10px 14px',
                background: '#f0f9ff', border: '1px solid #bae6fd',
                borderRadius: 4, fontSize: 13, color: '#0369a1',
                display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <span>Currently assigned: <strong>{fcClub.facultyCoordinator}</strong></span>
              </div>
            )}

            <form onSubmit={handleAssignFC} className={s.form}>
              <div className={s.field}>
                <label>
                  Faculty Coordinator Full Name <span className={s.req}>*</span>
                </label>
                <input
                  value={fcName}
                  onChange={e => setFcName(e.target.value)}
                  placeholder="e.g. Prof. Anita Mehta"
                  required
                />
              </div>

              <div className={s.field}>
                <label>
                  RKU Email Address <span className={s.req}>*</span>
                </label>
                <input
                  type="email"
                  value={fcEmail}
                  onChange={e => { setFcEmail(e.target.value); setFcAssignments([]); }}
                  onBlur={e => handleFcEmailLookup(e.target.value)}
                  placeholder="faculty.coordinator@rku.ac.in"
                  required
                />
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  If this email doesn't exist yet, a new account will be created and credentials emailed to them.
                  If it already exists, they'll receive a <strong>confirmation email only</strong> — their password won't be changed.
                </div>
              </div>

              {(fcLookingUp || fcAssignments.length > 0) && (
                <div style={{
                  padding: '10px 13px', borderRadius: 4,
                  background: '#f0f9ff', border: '1px solid #bae6fd',
                  fontSize: 13,
                }}>
                  {fcLookingUp ? (
                    <span style={{ color: '#0369a1' }}>Looking up…</span>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, color: '#0369a1', marginBottom: 6 }}>
                        Already managing {fcAssignments.length} club{fcAssignments.length !== 1 ? 's' : ''}:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {fcAssignments.map(a => (
                          <span key={a.id} style={{
                            padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                            background: a.is_active ? '#00c89618' : '#f3f4f6',
                            color: a.is_active ? '#007a5e' : '#9ca3af',
                            border: `1px solid ${a.is_active ? '#00c89640' : '#e5e7eb'}`,
                          }}>
                            {a.club_name}{!a.is_active ? ' (inactive)' : ''}
                          </span>
                        ))}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
                        Assigning to <strong>{fcClub?.name}</strong> will add the club to their dashboard. If they're a new user, a temporary password will be set.
                      </div>
                    </>
                  )}
                </div>
              )}

              {fcError && (
                <div style={{
                  padding: '10px 13px', borderRadius: 4,
                  background: '#fff0f0', border: '1px solid #fca5a5',
                  color: '#b91c1c', fontSize: 13,
                }}>{fcError}</div>
              )}

              <div className={s.modalFooter}>
                <button type="button" className={s.cancelBtn} onClick={closeAssignFC}>Cancel</button>
                <button type="submit" className={s.saveBtn} disabled={fcSaving}>
                  {fcSaving ? 'Assigning…' : 'Assign Faculty Coordinator'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ Add / Edit Modal ══ */}
      {modal && (
        <div className={s.overlay} onClick={closeModal}>
          <div className={s.modal} onClick={e => e.stopPropagation()} style={proposal ? { maxWidth: 760 } : undefined}>
            <div className={s.modalHeader}>
              <div>
                <div className={s.modalTag}>{proposal ? 'Create Club from Proposal' : modal === 'add' ? 'New Club' : 'Edit Club'}</div>
                <h2 className={s.modalTitle}>{modal === 'add' ? (proposal ? form.name || 'New Club' : 'Add New Club') : form.name || 'Edit Club'}</h2>
              </div>
              <button className={s.closeBtn} onClick={closeModal}>✕</button>
            </div>

            <form onSubmit={handleSave} className={s.form}>
              {/* Proposal reference — what the proposer originally submitted */}
              {proposal && (
                <div style={{ border: '1px solid #ddd6fe', background: '#f8f7ff', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1f1a4d' }}>
                        Proposed by {proposal.proposed_by_name}
                        <span style={{ fontWeight: 400, color: '#6b7280' }}> · {proposal.proposed_by_email}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        Submitted {formatDate(proposal.created_at)}. The form below is pre-filled from this application. Add the logo, check every field and fix anything that's wrong before creating.
                      </div>
                    </div>
                    <button type="button" onClick={() => setShowApp(v => !v)}
                      style={{ border: '1.5px solid #c4b5fd', background: '#fff', color: '#5b21b6', fontWeight: 700,
                        fontSize: 12, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      {showApp ? 'Hide application ▴' : 'Show application ▾'}
                    </button>
                  </div>
                  {showApp && (
                    <div style={{ maxHeight: 320, overflowY: 'auto', padding: '0 14px 14px' }}>
                      <ProposalDetails p={proposal} />
                    </div>
                  )}
                </div>
              )}

              {/* Logo upload */}
              <div className={s.logoSection}>
                <div
                  className={s.logoBox}
                  onClick={() => fileRef.current.click()}
                  style={{
                    borderColor: form.color + '60', background: form.color + '0a',
                    ...(proposal && !logoPreview ? { borderStyle: 'dashed', borderWidth: 2 } : {}),
                  }}
                >
                  {logoPreview
                    ? <img src={logoPreview} alt="preview" className={s.logoImg} />
                    : <div className={s.logoPlaceholder} style={{ color: form.color }}>
                        <span>Upload Logo</span>
                      </div>
                  }
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
                <div className={s.logoHint}>
                  {proposal && !logoPreview
                    ? <span style={{ color: '#b45309', fontWeight: 600 }}>Proposals don't include a logo, so upload one here · JPG, PNG, WEBP · max 5 MB</span>
                    : 'JPG, PNG, WEBP · max 5 MB'}
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Club Name <span className={s.req}>*</span></label>
                  <input value={form.name} onChange={sf('name')} placeholder="e.g. Android Development Club" required />
                </div>
                <div className={s.field}>
                  <label>Category <span className={s.req}>*</span></label>
                  <select value={form.category} onChange={sf('category')}>
                    {CATS.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  </select>
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Coordinator</label>
                  <input value={form.coordinator} onChange={sf('coordinator')} placeholder="e.g. Prof. Anita Mehta" />
                </div>
                <div className={s.field}>
                  <label>Accent Color</label>
                  <div className={s.colorRow}>
                    <input type="color" value={form.color} onChange={sf('color')} className={s.colorPicker} />
                    <input value={form.color} onChange={sf('color')} placeholder="#635BFF" className={s.colorText} />
                  </div>
                </div>
              </div>

              <div className={s.row3}>
                <div className={s.field}>
                  <label>Founded Year</label>
                  <input value={form.foundedYear} onChange={sf('foundedYear')} placeholder="e.g. 2019" />
                </div>
                <div className={s.field}>
                  <label>Members</label>
                  <input type="number" min="0" value={form.memberCount} onChange={sf('memberCount')} />
                </div>
                <div className={s.field}>
                  <label>Events</label>
                  <input type="number" min="0" value={form.eventCount} onChange={sf('eventCount')} />
                </div>
              </div>

              <div className={s.field}>
                <label>Description</label>
                <textarea rows={3} value={form.description} onChange={sf('description')} placeholder="Short description of the club…" />
              </div>

              {/* Extra fields only a proposal carries — shown so admin can correct them too */}
              {proposal && (<>
                <div className={s.field}>
                  <label>Vision / Objectives</label>
                  <textarea rows={3} value={form.vision} onChange={sf('vision')} placeholder="What the club aims to achieve…" />
                </div>
                <div className={s.row2}>
                  <div className={s.field}>
                    <label>Meeting Schedule</label>
                    <textarea rows={2} value={form.schedule} onChange={sf('schedule')} placeholder="e.g. Fridays 4pm, Lab 203" />
                  </div>
                  <div className={s.field}>
                    <label>Rules <span style={{ fontWeight: 400, color: '#9ca3af' }}>(one per line)</span></label>
                    <textarea rows={2} value={form.rules} onChange={sf('rules')} />
                  </div>
                </div>
              </>)}

              {/* Assign real FC/SC accounts at creation time — optional. Same
                  account creation-or-reuse + credentials-email flow as the
                  Assign FC / Assign Coordinator actions on the club card;
                  only ever offered while adding a new club. */}
              {modal === 'add' && (
                <div style={{
                  border: '1.5px dashed #e5e7eb', borderRadius: 8, padding: '14px 16px',
                  display: 'flex', flexDirection: 'column', gap: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#374151' }}>Assign Club Staff</div>
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                      Optional — leave blank to assign later from the club's card. Each gets a real account and a credentials email.
                    </div>
                    {proposal && (
                      <div style={{ fontSize: 11.5, color: '#92400e', background: '#fffbeb', borderRadius: 6, padding: '6px 10px', marginTop: 8 }}>
                        Pre-filled with the faculty advisor and coordinator named in the proposal. Check that the names and @rku.ac.in emails are correct, or clear them to skip.
                      </div>
                    )}
                  </div>

                  <div className={s.row2}>
                    <div className={s.field}>
                      <label>Faculty Coordinator Name</label>
                      <input value={form.fcName} onChange={sf('fcName')} placeholder="e.g. Prof. Anita Mehta" />
                    </div>
                    <div className={s.field}>
                      <label>Faculty Coordinator Email</label>
                      <input type="email" value={form.fcEmail} onChange={sf('fcEmail')} placeholder="faculty.coordinator@rku.ac.in" />
                    </div>
                  </div>

                  <div className={s.row2}>
                    <div className={s.field}>
                      <label>Student Coordinator Name</label>
                      <input value={form.scName} onChange={sf('scName')} placeholder="e.g. Priya Sharma" />
                    </div>
                    <div className={s.field}>
                      <label>Student Coordinator Email</label>
                      <input type="email" value={form.scEmail} onChange={sf('scEmail')} placeholder="student.coordinator@rku.ac.in" />
                    </div>
                  </div>
                </div>
              )}

              {error && <div className={s.formError}>{error}</div>}

              <div className={s.modalFooter}>
                <button type="button" className={s.cancelBtn} onClick={closeModal}>Cancel</button>
                <button type="submit" className={s.saveBtn} disabled={saving}>
                  {saving
                    ? (modal === 'add' && (logoFile || form.fcEmail?.trim() || form.scEmail?.trim())
                        ? 'Creating — uploading logo & setting up accounts…'
                        : 'Saving…')
                    : proposal ? 'Create Club & Approve Proposal' : modal === 'add' ? 'Create Club' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ Join Requests Panel ══ */}
      {reqClub && (
        <div className={s.overlay} onClick={() => setReqClub(null)}>
          <div className={s.panelModal} onClick={e => e.stopPropagation()}>
            <div className={s.panelHeader}>
              <div>
                <div className={s.modalTag}>Join Requests</div>
                <h2 className={s.modalTitle}>{reqClub.name}</h2>
                <p className={s.panelSub}>
                  {reqLoading ? 'Loading…' : `${requests.length} total · ${reqCounts.pending} pending · ${reqCounts.approved} approved · ${reqCounts.declined} declined`}
                </p>
              </div>
              <div className={s.panelHeaderRight}>
                <button className={s.csvBtn} onClick={exportReqsCSV} disabled={!requests.length}>Export CSV</button>
                <button className={s.closeBtn} onClick={() => setReqClub(null)}>✕</button>
              </div>
            </div>

            {/* Status filter tabs */}
            <div className={s.panelTabs}>
              {[['all','All'], ['pending','Pending'], ['approved','Approved'], ['declined','Declined']].map(([val, label]) => (
                <button key={val} className={`${s.panelTab} ${reqFilter === val ? s.panelTabOn : ''}`}
                  style={reqFilter === val ? {
                    background: val === 'pending' ? '#f59e0b18' : val === 'approved' ? '#00c89618' : val === 'declined' ? '#ef444418' : '#635bff18',
                    color:      val === 'pending' ? '#b45309'   : val === 'approved' ? '#007a5e'   : val === 'declined' ? '#dc2626'   : '#635bff',
                    borderColor:val === 'pending' ? '#f59e0b40' : val === 'approved' ? '#00c89640' : val === 'declined' ? '#ef444440' : '#635bff40',
                  } : {}}
                  onClick={() => setReqFilter(val)}>
                  {label}{val !== 'all' && ` (${reqCounts[val]})`}
                </button>
              ))}
            </div>

            <div className={s.panelTableWrap}>
              {reqLoading ? (
                <div className={s.panelEmpty}>Loading requests…</div>
              ) : filteredReqs.length === 0 ? (
                <div className={s.panelEmpty}>
                  <p>No {reqFilter !== 'all' ? reqFilter : ''} requests for this club.</p>
                </div>
              ) : (
                <table className={s.panelTable}>
                  <thead><tr>
                    <th>#</th><th>Name</th><th>Email</th><th>Enrollment</th>
                    <th>Dept</th><th>Year</th><th>Message</th><th>Submitted</th><th>Status</th><th>Action</th>
                  </tr></thead>
                  <tbody>
                    {filteredReqs.map((r, i) => {
                      const busy = actionId === r._id;
                      return (
                        <tr key={r._id}>
                          <td className={s.panelNum}>{i + 1}</td>
                          <td className={s.panelName}>{r.name}</td>
                          <td className={s.panelEmail}>{r.email}</td>
                          <td><span className={s.enrollBadge}>{r.enrollmentNo || '—'}</span></td>
                          <td><span className={s.deptBadge}>{r.dept || '—'}</span></td>
                          <td>{r.year || '—'}</td>
                          <td className={s.panelMsg}>{r.message ? r.message.slice(0, 60) + (r.message.length > 60 ? '…' : '') : '—'}</td>
                          <td className={s.panelDate}>{r.createdAt ? new Date(r.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'}</td>
                          <td>
                            <span className={s.statusBadge} style={{
                              background: r.status === 'pending' ? '#f59e0b18' : r.status === 'approved' ? '#00c89618' : '#ef444418',
                              color:      r.status === 'pending' ? '#b45309'   : r.status === 'approved' ? '#007a5e'   : '#dc2626',
                            }}>{r.status}</span>
                          </td>
                          <td>
                            {r.status === 'pending' ? (
                              <div style={{ display:'flex', gap:5 }}>
                                <button className={s.approveBtn} onClick={() => handleApprove(r._id)} disabled={busy}>
                                  {busy ? '…' : '✓'}
                                </button>
                                <button className={s.declineBtn} onClick={() => handleDecline(r._id)} disabled={busy}>
                                  {busy ? '…' : '✕'}
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: '.72rem', color: '#9ca3af' }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ Members Panel ══ */}
      {membClub && (
        <div className={s.overlay} onClick={() => setMembClub(null)}>
          <div className={s.panelModal} onClick={e => e.stopPropagation()}>
            <div className={s.panelHeader}>
              <div>
                <div className={s.modalTag}>Club Members</div>
                <h2 className={s.modalTitle}>{membClub.name}</h2>
                <p className={s.panelSub}>
                  {membLoading ? 'Loading…' : `${members.length} enrolled member${members.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div className={s.panelHeaderRight}>
                <button className={s.csvBtn} onClick={exportMembsCSV} disabled={!members.length}>Export CSV</button>
                <button className={s.closeBtn} onClick={() => setMembClub(null)}>✕</button>
              </div>
            </div>

            <div className={s.panelSearch}>
              <input className={s.panelSearchInput} placeholder="Search by name, email, or department…"
                value={membSearch} onChange={e => setMembSearch(e.target.value)} />
            </div>

            <div className={s.panelTableWrap}>
              {membLoading ? (
                <div className={s.panelEmpty}>Loading members…</div>
              ) : members.length === 0 ? (
                  <p>No members enrolled yet. Approve join requests to add members.</p>
              ) : filteredMembs.length === 0 ? (
                <div className={s.panelEmpty}>No members match your search.</div>
              ) : (
                <table className={s.panelTable}>
                  <thead><tr>
                    <th>#</th><th>Name</th><th>Email</th><th>Department</th><th>Year</th><th>Joined</th>
                  </tr></thead>
                  <tbody>
                    {filteredMembs.map((m, i) => (
                      <tr key={m.id || i}>
                        <td className={s.panelNum}>{i + 1}</td>
                        <td className={s.panelName}>{m.name}</td>
                        <td className={s.panelEmail}>{m.email}</td>
                        <td><span className={s.deptBadge}>{m.dept || '—'}</span></td>
                        <td>{m.year || '—'}</td>
                        <td className={s.panelDate}>
                          {m.joined_at ? new Date(m.joined_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ Leadership Panel ══ */}
      {leaderClub && (
        <div className={s.overlay} onClick={() => setLeaderClub(null)}>
          <div className={s.panelModal} onClick={e => e.stopPropagation()}>
            <div className={s.panelHeader}>
              <div>
                <div className={s.modalTag}>Leadership Team</div>
                <h2 className={s.modalTitle}>{leaderClub.name}</h2>
                <p className={s.panelSub}>
                  {leaderLoading ? 'Loading…' : `${leaderItems.length} position${leaderItems.length !== 1 ? 's' : ''} defined`}
                </p>
              </div>
              <button className={s.closeBtn} onClick={() => setLeaderClub(null)}>✕</button>
            </div>

            <div style={{ padding: '0 24px 24px' }}>
              {leaderLoading ? (
                <div className={s.panelEmpty}>Loading leadership…</div>
              ) : leaderItems.length === 0 ? (
                <div className={s.panelEmpty}>
                  <p>No leadership positions defined yet for this club.</p>
                  <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
                    The coordinator can add them from their dashboard → Leadership tab.
                  </p>
                </div>
              ) : (
                <div className={s.leaderGrid}>
                  {leaderItems.map((pos, i) => {
                    const GRADIENTS = [
                      'linear-gradient(135deg,#635BFF,#A259FF)',
                      'linear-gradient(135deg,#FF6B9D,#A259FF)',
                      'linear-gradient(135deg,#3DDC84,#635BFF)',
                      'linear-gradient(135deg,#FF9500,#FF6B9D)',
                      'linear-gradient(135deg,#06D6A0,#00AADD)',
                      'linear-gradient(135deg,#FFD166,#FF9500)',
                    ];
                    const initials = (n = '') =>
                      n.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
                    return (
                      <div key={pos.id || i} className={s.leaderCard}>
                        {/* Avatar */}
                        {pos.photo_url ? (
                          <img src={pos.photo_url} alt={pos.holder_name || pos.role_title}
                            className={s.leaderAv} style={{ objectFit: 'cover' }} />
                        ) : (
                          <div className={s.leaderAv}
                            style={{ background: GRADIENTS[i % GRADIENTS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: '1.1rem' }}>
                            {initials(pos.holder_name || pos.role_title)}
                          </div>
                        )}
                        {/* Role badge */}
                        <div className={s.leaderRole}
                          style={{ background: (leaderClub.color || '#635bff') + '18', color: leaderClub.color || '#635bff' }}>
                          {pos.role_title}
                        </div>
                        <div className={s.leaderName}>
                          {pos.holder_name || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Vacant</span>}
                        </div>
                        {pos.holder_email && <div className={s.leaderEmail}>{pos.holder_email}</div>}
                        {pos.responsibilities && (
                          <div className={s.leaderDesc}>{pos.responsibilities}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ Delete confirm ══ */}
      {deleteId && (
        <div className={s.overlay} onClick={() => setDeleteId(null)}>
          <div className={s.confirmBox} onClick={e => e.stopPropagation()}>
            <h3>Delete this club?</h3>
            <p>It will be removed from the guest site immediately.</p>
            <div className={s.confirmBtns}>
              <button className={s.cancelBtn} onClick={() => setDeleteId(null)}>Cancel</button>
              <button className={s.delConfirmBtn} onClick={handleDelete}>Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
