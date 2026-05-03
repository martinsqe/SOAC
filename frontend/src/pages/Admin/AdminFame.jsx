import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import s from './AdminClubs.module.css'; // Reusing some base CRUD styles

const EMPTY = {
  name: '', achievement: '', description: '', term: '',
  club_id: '', club_name: '',
  year: '', category: 'General', sort_order: 0,
};

export default function AdminFame() {
  const [items,      setItems]    = useState([]);
  const [clubs,      setClubs]    = useState([]);
  const [loading,    setLoading]  = useState(true);
  const [modal,      setModal]    = useState(false);
  const [form,       setForm]     = useState(EMPTY);
  const [editing,    setEditing]  = useState(null);
  const [file,       setFile]     = useState(null);
  const [prev,       setPrev]     = useState('');
  const [saving,     setSaving]   = useState(false);
  const [error,      setError]    = useState('');
  const [deleteId,   setDeleteId] = useState(null);

  const fileRef = useRef();

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get('/fame'),
      api.get('/clubs?limit=100')
    ]).then(([f, c]) => {
      setItems(f.items || []);
      setClubs(c.clubs || []);
    }).catch(() => setError('Failed to load data.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => {
    setForm(EMPTY); setEditing(null); setFile(null); setPrev(''); setModal(true); setError('');
  };
  const openEdit = (it) => {
    setForm({
      name: it.name, achievement: it.achievement, 
      description: it.description || '', term: it.term || '',
      club_id: it.club_id || '', club_name: it.club_name || '',
      year: it.year || '', category: it.category || 'General', 
      sort_order: it.sort_order || 0
    });
    setEditing(it.id);
    setPrev(it.imageUrl || '');
    setFile(null);
    setModal(true);
    setError('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name || !form.achievement) return setError('Name and Achievement are required.');
    setSaving(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append('image', file);
      
      if (editing) await api.putForm(`/fame/${editing}`, fd);
      else         await api.postForm('/fame', fd);

      setModal(false); load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleDel = async () => {
    try {
      await api.delete(`/fame/${deleteId}`);
      setDeleteId(null); load();
    } catch (err) { setError(err.message); }
  };

  const sf = (k) => (e) => {
    const v = e.target.value;
    if (k === 'club_id' && v) {
      const c = clubs.find(cl => String(cl._id) === String(v));
      setForm(p => ({ ...p, club_id: v, club_name: c?.name || '' }));
    } else {
      setForm(p => ({ ...p, [k]: v }));
    }
  };

  return (
    <div style={{ padding: 30 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:30 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a' }}>Manage Wall of Fame</h1>
          <p style={{ color: '#64748b', fontSize: 14 }}>Add or edit achievements visible to all members.</p>
        </div>
        <button onClick={openAdd} style={{ background:'#635BFF', color:'#fff', padding:'10px 20px', borderRadius:10, border:'none', fontWeight:700, cursor:'pointer' }}>+ Add Legend</button>
      </div>

      {loading ? <p>Loading legends…</p> : (
        <div style={{ background:'#fff', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
            <thead>
              <tr style={{ background:'#f8fafc', borderBottom:'1px solid #e2e8f0' }}>
                <th style={{ padding:15, textAlign:'left' }}>Legend</th>
                <th style={{ padding:15, textAlign:'left' }}>Achievement</th>
                <th style={{ padding:15, textAlign:'left' }}>Club</th>
                <th style={{ padding:15, textAlign:'left' }}>Year</th>
                <th style={{ padding:15, textAlign:'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                  <td style={{ padding:15 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:40, height:40, borderRadius:8, background:'#f1f5f9', overflow:'hidden' }}>
                        {it.imageUrl && <img src={it.imageUrl} style={{ width:'100%', height:'100%', objectFit:'cover' }} />}
                      </div>
                      <span style={{ fontWeight:600 }}>{it.name}</span>
                    </div>
                  </td>
                  <td style={{ padding:15, color:'#635BFF', fontWeight:500 }}>{it.achievement}</td>
                  <td style={{ padding:15 }}>{it.club_name || '—'}</td>
                  <td style={{ padding:15 }}>{it.year}</td>
                  <td style={{ padding:15, textAlign:'right' }}>
                    <button onClick={() => openEdit(it)} style={{ padding:'6px 12px', borderRadius:6, border:'1px solid #e2e8f0', background:'#fff', marginRight:8, cursor:'pointer' }}>Edit</button>
                    <button onClick={() => setDeleteId(it.id)} style={{ padding:'6px 12px', borderRadius:6, border:'1px solid #fee2e2', color:'#ef4444', background:'#fff', cursor:'pointer' }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={() => setModal(false)}>
          <div style={{ background:'#fff', padding:30, borderRadius:20, width:'100%', maxWidth:500 }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom:20 }}>{editing ? 'Edit' : 'Add'} Hall of Fame Entry</h2>
            <form onSubmit={handleSave} style={{ display:'grid', gap:16 }}>
              <div style={{ textAlign:'center' }}>
                <div onClick={() => fileRef.current.click()} style={{ width:100, height:100, borderRadius:15, background:'#f8fafc', border:'2px dashed #e2e8f0', margin:'0 auto 10px', overflow:'hidden', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  {prev ? <img src={prev} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : <span>📷</span>}
                </div>
                <input ref={fileRef} type="file" hidden onChange={e => {
                  const f = e.target.files[0];
                  if (!f) return;
                  setFile(f);
                  setPrev(URL.createObjectURL(f));
                }} />
                <p style={{ fontSize:11, color:'#94a3b8' }}>Square photo recommended</p>
              </div>

              <input placeholder="Name (Student or Club)" value={form.name} onChange={sf('name')} style={{ padding:12, borderRadius:10, border:'1.5px solid #e2e8f0', outline:'none' }} />
              <input placeholder="Achievement Title (e.g. Best Tech Club)" value={form.achievement} onChange={sf('achievement')} style={{ padding:12, borderRadius:10, border:'1.5px solid #e2e8f0', outline:'none' }} />
              <textarea placeholder="Detailed Description..." value={form.description} onChange={sf('description')} rows={3} style={{ padding:12, borderRadius:10, border:'1.5px solid #e2e8f0', outline:'none', resize:'none', fontFamily:'inherit' }} />
              
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <input placeholder="Term (e.g. Sem 4 / Fall)" value={form.term} onChange={sf('term')} style={{ padding:12, borderRadius:10, border:'1.5px solid #e2e8f0', outline:'none' }} />
                <input placeholder="Year (e.g. 2024-25)" value={form.year} onChange={sf('year')} style={{ padding:12, borderRadius:10, border:'1.5px solid #e2e8f0', outline:'none' }} />
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <select value={form.club_id} onChange={sf('club_id')} style={{ padding:12, borderRadius:10, border:'1.5px solid #e2e8f0', outline:'none', background:'#fff' }}>
                  <option value="">No Club</option>
                  {clubs.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                </select>
                <select value={form.category} onChange={sf('category')} style={{ padding:12, borderRadius:10, border:'1.5px solid #e2e8f0', outline:'none', background:'#fff' }}>
                   {['General', 'Tech', 'Sports', 'Cultural', 'Social', 'Academic'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                 <div style={{ display:'flex', alignItems:'center', gap:8, padding:'0 5px' }}>
                    <span style={{ fontSize:12, fontWeight:700, color:'#94a3b8' }}>Order</span>
                    <input type="number" value={form.sort_order} onChange={sf('sort_order')} style={{ width:'100%', padding:12, borderRadius:10, border:'1.5px solid #e2e8f0', outline:'none' }} />
                 </div>
              </div>

              {error && <p style={{ color:'#ef4444', fontSize:12 }}>{error}</p>}

              <div style={{ display:'flex', gap:10, marginTop:10 }}>
                <button type="button" onClick={() => setModal(false)} style={{ flex:1, padding:12, borderRadius:10, border:'1px solid #e2e8f0', background:'none', cursor:'pointer' }}>Cancel</button>
                <button type="submit" disabled={saving} style={{ flex:2, padding:12, borderRadius:10, border:'none', background:'#635BFF', color:'#fff', fontWeight:700, cursor:'pointer', opacity:saving?.6:1 }}>{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteId && (
        <div style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.5)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={() => setDeleteId(null)}>
           <div style={{ background:'#fff', padding:30, borderRadius:20, width:'100%', maxWidth:400, textAlign:'center' }} onClick={e => e.stopPropagation()}>
              <div style={{ fontSize:40, marginBottom:10 }}>🗑️</div>
              <h3>Remove from Wall?</h3>
              <p style={{ color:'#64748b', fontSize:14, marginBottom:20 }}>This action can be undone by an admin later, but it will be hidden from everyone.</p>
              <div style={{ display:'flex', gap:10 }}>
                <button onClick={() => setDeleteId(null)} style={{ flex:1, padding:12, borderRadius:10, border:'1px solid #e2e8f0', background:'none' }}>Cancel</button>
                <button onClick={handleDel} style={{ flex:1, padding:12, borderRadius:10, border:'none', background:'#ef4444', color:'#fff', fontWeight:700 }}>Remove</button>
              </div>
           </div>
        </div>
      )}
    </div>
  );
}
