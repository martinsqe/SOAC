import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import StudentImportModal from '../../components/StudentImportModal/StudentImportModal';
import s from './AdminCRUD.module.css';
import r from './AdminStudents.module.css';

/* University student directory — one Excel file per department (School). Event
   registration (Galore first) looks students up here by Enrollment No. or
   Admission No. and fills their details from the record. */
export default function AdminStudents() {
  const [departments, setDepartments] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [importFor,   setImportFor]   = useState(null);   // null | { code, name } ('' code = pick)
  const [deleteDept,  setDeleteDept]  = useState(null);
  const [error,       setError]       = useState('');

  const [q,          setQ]          = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [students,   setStudents]   = useState([]);
  const [searching,  setSearching]  = useState(false);

  const loadDepts = useCallback(() => {
    api.get('/students/departments')
      .then(d => setDepartments(d.departments || []))
      .catch(err => setError(err.message || 'Could not load departments.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadDepts(); }, [loadDepts]);

  /* Search as you type (debounced) */
  useEffect(() => {
    if (!q.trim() && !deptFilter) return; // results are hidden when there's no query
    const t = setTimeout(() => {
      setSearching(true);
      const params = new URLSearchParams({ q: q.trim(), ...(deptFilter && { departmentId: deptFilter }) });
      api.get(`/students?${params}`)
        .then(d => setStudents(d.students || []))
        .catch(() => setStudents([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, deptFilter]);

  const confirmDelete = async () => {
    try {
      const d = await api.delete(`/students/departments/${deleteDept.id}`);
      setDepartments(d.departments || []);
      setDeleteDept(null);
    } catch (err) { setError(err.message || 'Could not delete.'); setDeleteDept(null); }
  };

  const total = departments.reduce((n, d) => n + d.students, 0);

  return (
    <div className={s.page}>
      <div className={s.pageHeader}>
        <div>
          <h1 className={s.pageTitle}>Student Directory</h1>
          <p className={s.pageSub}>
            {total.toLocaleString('en-IN')} students across {departments.length} department{departments.length === 1 ? '' : 's'} ·
            students register by Enrollment No. or Admission No., and their details fill in from here
          </p>
        </div>
        <button className={r.redBtn} onClick={() => setImportFor({ code: '', name: '' })}>+ Upload department file</button>
      </div>

      {error && <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: '.85rem' }}>{error}</div>}

      <div className={s.tableWrap}>
        {loading ? <div className={s.loader}>Loading…</div> : departments.length === 0 ? (
          <div className={s.empty}>
            <p>No departments yet</p>
            <span>Upload a department's student Excel file to start. Each file is one School (e.g. SOE) with all its courses.</span>
          </div>
        ) : (
          <table className={s.table}>
            <thead>
              <tr><th>Department</th><th>Students</th><th>Last upload</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {departments.map(d => (
                <tr key={d.id}>
                  <td><strong>{d.code}</strong>{d.name && <div className={s.muted}>{d.name}</div>}</td>
                  <td className={r.countCell}>{d.students.toLocaleString('en-IN')}</td>
                  <td className={s.muted}>
                    {d.lastImport ? <>{d.lastImport.fileName}<br />{new Date(d.lastImport.at).toLocaleString('en-IN')} · +{d.lastImport.added} / ~{d.lastImport.updated}</> : '—'}
                  </td>
                  <td>
                    <div className={s.actions}>
                      <button className={r.redSmall} onClick={() => setImportFor({ code: d.code, name: d.name })}>Upload new file</button>
                      <button className={r.redOutline} onClick={() => setDeleteDept(d)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 style={{ fontSize: '1rem', margin: '28px 0 10px', color: '#0f0a2e' }}>Find a student</h2>
      <div className={s.filters}>
        <input className={s.searchInput} value={q} onChange={e => setQ(e.target.value)} placeholder="Name, enrollment no., admission no. or email…" />
        <select className={s.searchInput} style={{ maxWidth: 200 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">All departments</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.code}</option>)}
        </select>
      </div>
      {(q.trim() || deptFilter) && (
        <div className={s.tableWrap}>
          {searching ? <div className={s.loader}>Searching…</div> : students.length === 0 ? (
            <div className={s.empty}><p>No matching students</p></div>
          ) : (
            <table className={s.table}>
              <thead>
                <tr><th>Name</th><th>Enrollment / Admission</th><th>Dept · Program</th><th>Semester</th><th>Email</th><th>Mobile</th><th>Gender</th></tr>
              </thead>
              <tbody>
                {students.map(st => (
                  <tr key={st.id}>
                    <td><strong>{st.name}</strong></td>
                    <td>{st.enrollmentNo || <span className={s.muted}>—</span>}<div className={s.muted}>{st.admissionNo}</div></td>
                    <td>{st.department}<div className={s.muted}>{[st.subDepartment, st.program].filter(Boolean).join(' · ')}</div></td>
                    <td>{st.semester || '—'}</td>
                    <td>{st.email || <span style={{ color: '#b45309' }}>missing</span>}</td>
                    <td>{st.phone || '—'}</td>
                    <td>{st.gender || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {importFor && (
        <StudentImportModal
          departmentCode={importFor.code}
          departmentName={importFor.name}
          departments={departments}
          onClose={() => setImportFor(null)}
          onImported={loadDepts}
        />
      )}

      {deleteDept && (
        <div className={s.overlay} onClick={() => setDeleteDept(null)}>
          <div className={s.confirmBox} onClick={e => e.stopPropagation()}>
            <h3>Delete {deleteDept.code}?</h3>
            <p>
              This removes the department and its {deleteDept.students.toLocaleString('en-IN')} student records from the directory.
              Existing event registrations are kept, but these students won't be able to verify for new registrations until the file is uploaded again.
            </p>
            <div className={s.confirmBtns}>
              <button className={s.cancelBtn} onClick={() => setDeleteDept(null)}>Cancel</button>
              <button className={r.redConfirm} onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
