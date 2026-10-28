import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';

/* Upload a department's student Excel files — one per course — into the
   university student directory: set the department, add as many course files
   as it has (the preview re-runs on every add/remove, so the totals keep adding
   up), check what will be added / updated / skipped, then save them all
   together. Used from Admin → Student Directory and the Galore builder. */

const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,10,46,.45)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 };
const box     = { background: '#fff', borderRadius: 14, width: '100%', maxWidth: 760, maxHeight: '92vh', overflowY: 'auto', padding: '22px 24px', boxShadow: '0 24px 60px rgba(0,0,0,.2)' };
const label   = { fontSize: '.78rem', fontWeight: 700, color: '#374151', display: 'block', marginBottom: 4 };
const input   = { padding: '8px 10px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: '.86rem', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const primary = { padding: '9px 18px', border: 'none', borderRadius: 8, background: '#635BFF', color: '#fff', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', fontFamily: 'inherit' };
const ghost   = { padding: '9px 16px', border: '1.5px solid #e5e7eb', borderRadius: 8, background: '#fff', color: '#374151', fontWeight: 600, fontSize: '.85rem', cursor: 'pointer', fontFamily: 'inherit' };
const stat    = (bg, fg) => ({ background: bg, color: fg, borderRadius: 10, padding: '10px 12px', flex: '1 1 110px', textAlign: 'center' });

export default function StudentImportModal({ departmentCode = '', departmentName = '', departments = [], onClose, onImported }) {
  const [code,    setCode]    = useState(departmentCode);
  const [name,    setName]    = useState(departmentName);
  const [files,   setFiles]   = useState([]);   // one per course
  const [preview, setPreview] = useState(null);
  const [done,    setDone]    = useState(null);
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const fileRef = useRef();

  const known = departments.find(d => d.code.toUpperCase() === code.trim().toUpperCase());

  const send = async (dryRun, list = files) => {
    const fd = new FormData();
    list.forEach(f => fd.append('files', f));
    fd.append('departmentCode', code.trim());
    fd.append('departmentName', name.trim());
    fd.append('dryRun', dryRun ? '1' : '0');
    return api.postForm('/students/import', fd);
  };

  /* Every add/remove re-checks the whole set, so the totals always cover all files */
  const runPreview = async (list = files) => {
    if (!list.length) { setPreview(null); return; }
    if (!code.trim()) return setError('Enter the department code first (as in the "School" column, e.g. SOE).');
    setBusy(true); setError('');
    try { setPreview(await send(true, list)); }
    catch (err) { setPreview(null); setError(err.message || 'Could not read the files.'); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    setBusy(true); setError('');
    try {
      const r = await send(false);
      setDone(r);
      onImported?.(r);
    } catch (err) { setError(err.message || 'Import failed — nothing was saved.'); }
    finally { setBusy(false); }
  };

  const addFiles = (e) => {
    const picked = [...(e.target.files || [])];
    e.target.value = ''; // lets the same file be picked again after removing it
    if (!picked.length) return;
    const next = [...files];
    for (const f of picked) if (!next.some(x => x.name === f.name)) next.push(f);
    setFiles(next);
    runPreview(next);
  };
  const removeFile = (fname) => {
    const next = files.filter(f => f.name !== fname);
    setFiles(next);
    runPreview(next);
  };
  const statsFor = (fname) => preview?.files?.find(f => f.fileName === fname);

  /* Portal: it can be opened from inside another modal's <form> (the Galore
     builder) without its Enter key or buttons submitting that form. */
  return createPortal(
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: '.7rem', fontWeight: 700, color: '#635BFF', textTransform: 'uppercase', letterSpacing: '.05em' }}>Student Directory</div>
            <h2 style={{ margin: '2px 0 0', fontSize: '1.2rem', color: '#0f0a2e' }}>Upload department student list</h2>
          </div>
          <button type="button" onClick={onClose} style={{ ...ghost, padding: '4px 10px' }}>✕</button>
        </div>

        {done ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: '2rem', color: '#059669' }}>✓</div>
            <h3 style={{ margin: '6px 0' }}>{done.department} student list saved</h3>
            <p style={{ color: '#6b7280', fontSize: '.88rem', margin: '0 0 4px' }}>
              {done.files?.length || 1} file{(done.files?.length || 1) === 1 ? '' : 's'} · {done.added} added · {done.updated} updated · {done.unchanged} unchanged · {done.skipped} skipped
            </p>
            <p style={{ color: '#0f0a2e', fontSize: '.95rem', fontWeight: 700, margin: '0 0 16px' }}>
              {done.department} now has {Number(done.departmentTotalAfter || 0).toLocaleString('en-IN')} students
            </p>
            <button type="button" style={primary} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '1 1 140px' }}>
                <label style={label}>Department code *</label>
                <input style={input} value={code} list="dir-dept-codes" maxLength={30} placeholder="e.g. SOE"
                  disabled={!!departmentCode || files.length > 0} onChange={e => { setCode(e.target.value); setPreview(null); }} />
                <datalist id="dir-dept-codes">{departments.map(d => <option key={d.id} value={d.code}>{d.name}</option>)}</datalist>
              </div>
              <div style={{ flex: '2 1 220px' }}>
                <label style={label}>Department name {known ? '' : '(new department)'}</label>
                <input style={input} value={known && !name ? known.name : name} maxLength={150} placeholder="e.g. School of Engineering"
                  onChange={e => setName(e.target.value)} />
              </div>
            </div>
            <p style={{ fontSize: '.76rem', color: '#6b7280', margin: '0 0 12px' }}>
              Add one file per course. The code must match the <strong>School</strong> column of every file. Rows from a different School are skipped.
              Only name, enrollment / admission no., email, mobile, gender, department, program and semester are saved. Aadhar, caste, address,
              birth date and parents' details are ignored.
            </p>

            {/* ── Course files ── */}
            {files.length > 0 && (
              <div style={{ border: '1px solid #f0f0f5', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
                {files.map(f => {
                  const st = statsFor(f.name);
                  return (
                    <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid #f9f9fb', fontSize: '.82rem', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: '#0f0a2e', flex: '1 1 180px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f.name}</span>
                      {st ? (
                        <span style={{ color: '#6b7280' }}>
                          {st.rowsRead} rows · <span style={{ color: '#047857' }}>{st.added} new</span>
                          {st.updated > 0 && <> · <span style={{ color: '#1d4ed8' }}>{st.updated} updated</span></>}
                          {st.unchanged > 0 && <> · {st.unchanged} unchanged</>}
                          {st.skipped > 0 && <> · <span style={{ color: '#b91c1c' }}>{st.skipped} skipped</span></>}
                          {st.warnings > 0 && <> · <span style={{ color: '#b45309' }}>{st.warnings} warning{st.warnings === 1 ? '' : 's'}</span></>}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>{busy ? 'checking…' : ''}</span>
                      )}
                      <button type="button" title="Remove this file" disabled={busy} onClick={() => removeFile(f.name)}
                        style={{ border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '.95rem', padding: '2px 4px' }}>✕</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div onClick={() => !busy && fileRef.current.click()} style={{
              border: '1.5px dashed #c7d2fe', borderRadius: 10, padding: files.length ? '10px' : '16px', textAlign: 'center',
              cursor: busy ? 'wait' : 'pointer', background: '#fafaff', marginBottom: 12, fontSize: '.86rem', color: '#635BFF', fontWeight: 600,
            }}>
              {files.length ? '+ Add another course file' : 'Click to choose the course Excel files (.xlsx) — you can pick several at once'}
            </div>
            <input ref={fileRef} type="file" accept=".xlsx" multiple style={{ display: 'none' }} onChange={addFiles} />

            {preview && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  <div style={stat('#ecfdf5', '#047857')}><strong style={{ fontSize: '1.2rem' }}>{preview.added}</strong><br />new</div>
                  <div style={stat('#eff6ff', '#1d4ed8')}><strong style={{ fontSize: '1.2rem' }}>{preview.updated}</strong><br />updated</div>
                  <div style={stat('#f9fafb', '#4b5563')}><strong style={{ fontSize: '1.2rem' }}>{preview.unchanged}</strong><br />unchanged</div>
                  <div style={stat('#fef2f2', '#b91c1c')}><strong style={{ fontSize: '1.2rem' }}>{preview.skipped}</strong><br />skipped</div>
                  <div style={stat('#fffbeb', '#b45309')}><strong style={{ fontSize: '1.2rem' }}>{preview.warnings}</strong><br />warnings</div>
                </div>
                <div style={{ fontSize: '.8rem', color: '#374151', marginBottom: 6 }}>
                  <strong>{preview.rowsRead.toLocaleString('en-IN')}</strong> rows read from {preview.files?.length || 1} file{(preview.files?.length || 1) === 1 ? '' : 's'} ·{' '}
                  {preview.department} will have <strong>{Number(preview.departmentTotalAfter || 0).toLocaleString('en-IN')}</strong> students
                  {preview.departmentTotalBefore > 0 && <> (now {preview.departmentTotalBefore.toLocaleString('en-IN')})</>}.
                  <span style={{ color: '#6b7280' }}> Nothing is saved until you confirm.</span>
                </div>
                {preview.issues.length > 0 && (
                  <div style={{ border: '1px solid #f0f0f5', borderRadius: 8, maxHeight: 220, overflowY: 'auto' }}>
                    {preview.issues.map((i, k) => (
                      <div key={k} style={{ display: 'flex', gap: 8, padding: '6px 10px', fontSize: '.78rem', borderBottom: '1px solid #f9f9fb' }}>
                        <span style={{ color: i.level === 'error' ? '#b91c1c' : '#b45309', fontWeight: 700, flex: '0 0 auto' }}>
                          {i.level === 'error' ? 'Skipped' : 'Warning'}
                        </span>
                        <span style={{ color: '#9ca3af', flex: '0 0 auto' }}>{i.file ? `${i.file} · ` : ''}row {i.row}</span>
                        <span style={{ color: '#374151' }}>{i.message}</span>
                      </div>
                    ))}
                    {preview.issuesTruncated && <div style={{ padding: '6px 10px', fontSize: '.75rem', color: '#9ca3af' }}>…more not shown</div>}
                  </div>
                )}
              </div>
            )}

            {error && <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '8px 12px', fontSize: '.82rem', marginBottom: 12 }}>{error}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" style={ghost} onClick={onClose}>Cancel</button>
              {preview && preview.added + preview.updated > 0 ? (
                <button type="button" style={primary} disabled={busy} onClick={confirm}>
                  {busy ? 'Saving…' : `Save ${(preview.added + preview.updated).toLocaleString('en-IN')} student${preview.added + preview.updated === 1 ? '' : 's'} from ${files.length} file${files.length === 1 ? '' : 's'}`}
                </button>
              ) : (
                <button type="button" style={primary} disabled={busy || !files.length} onClick={() => runPreview()}>{busy ? 'Checking…' : 'Preview'}</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
