import { useState, useEffect } from 'react';
import api from '../../api/client';

const ACTION_MAP = {
  CREATE_CLUB:        { label: 'Club created',         color: '#22c55e' },
  UPDATE_CLUB:        { label: 'Club updated',         color: '#3b82f6' },
  DELETE_CLUB:        { label: 'Club removed',         color: '#ef4444' },
  CREATE_EVENT:       { label: 'Event created',        color: '#22c55e' },
  UPDATE_EVENT:       { label: 'Event updated',        color: '#3b82f6' },
  DELETE_EVENT:       { label: 'Event removed',        color: '#ef4444' },
  CREATE_USER:        { label: 'User added',           color: '#8b5cf6' },
  ASSIGN_COORDINATOR: { label: 'Coordinator assigned', color: '#f59e0b' },
  ASSIGN_CLUB:        { label: 'Club assigned',        color: '#f59e0b' },
};

const TRUNC = 90;
const trunc = (str) => (str && str.length > TRUNC ? str.slice(0, TRUNC) + '…' : str || '—');

const timeAgo = (iso) => {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

function AuditChanges({ changes }) {
  if (!changes?.length) return null;
  return (
    <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {changes.map((c, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'baseline', flexWrap: 'wrap',
          gap: '3px 6px', fontSize: '0.72rem', lineHeight: 1.5,
        }}>
          <span style={{ fontWeight: 700, color: '#7b6fa0', flexShrink: 0 }}>{c.field}:</span>
          {c.from && (
            <span style={{
              color: '#b0a8cc',
              maxWidth: 'min(180px, 38vw)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {trunc(c.from)}
            </span>
          )}
          <span style={{ color: '#c4b5fd', flexShrink: 0 }}>{c.from ? '→' : 'set to'}</span>
          <span style={{
            color: '#1a1040', fontWeight: 500,
            maxWidth: 'min(240px, 48vw)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {trunc(c.to)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function AdminAuditLog() {
  const [log,     setLog]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [page,    setPage]    = useState(1);
  const [total,   setTotal]   = useState(0);
  const LIMIT = 30;

  useEffect(() => {
    setLoading(true);
    api.get(`/users/meta/audit?page=${page}&limit=${LIMIT}`)
      .then(d => {
        setLog(d.log || d.audit || []);
        setTotal(d.pagination?.total || d.total || 0);
        setError('');
      })
      .catch(err => setError(err.message || 'Failed to load audit log.'))
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={{ padding: 'clamp(16px, 4vw, 28px)', maxWidth: 860, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{
          margin: 0, fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontWeight: 900, fontSize: 'clamp(1.25rem, 4vw, 1.5rem)', color: '#0f0a2e',
        }}>
          Audit Log
        </h1>
        <p style={{ margin: '5px 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
          Full history of all admin and coordinator actions
          {total > 0 && <> · {total} entries</>}
        </p>
      </div>

      {error && (
        <div style={{
          background: '#fff0f0', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '12px 16px', color: '#b91c1c', marginBottom: 20, fontSize: '0.875rem',
        }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{
              height: 58, background: '#f3f4f6', borderRadius: i === 0 ? '12px 12px 0 0' : i === 7 ? '0 0 12px 12px' : 0,
            }} />
          ))}
        </div>
      ) : log.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: '#f8f7ff', borderRadius: 16, border: '2px dashed #e0deff',
        }}>
          <div style={{ fontWeight: 700, color: '#1a1040', marginBottom: 6 }}>No audit entries yet</div>
          <p style={{ color: '#6b7280', fontSize: '0.875rem', margin: 0 }}>
            Admin and coordinator actions will be recorded here.
          </p>
        </div>
      ) : (
        <>
          <div style={{
            background: '#fff', borderRadius: 16,
            border: '1px solid #ebebf0', overflow: 'hidden',
            boxShadow: '0 1px 8px rgba(0,0,0,.05)',
          }}>
            {log.map((row, i) => {
              const info  = ACTION_MAP[row.action] || { label: row.action, color: '#7b6fa0' };
              const meta  = row.meta
                ? (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta)
                : {};
              const entityName = meta.name || meta.title || meta.email || null;

              return (
                <div key={row.id || i} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr max-content',
                  gap: '0 12px',
                  padding: '13px 20px',
                  borderBottom: i < log.length - 1 ? '1px solid #f3f4f6' : 'none',
                  alignItems: 'start',
                }}>
                  {/* Left: action + changes */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '0.875rem', lineHeight: 1.45 }}>
                      <span style={{ color: info.color, fontWeight: 700 }}>{info.label}</span>
                      {entityName && (
                        <span style={{ color: '#374151' }}> · {entityName}</span>
                      )}
                      {meta.coordinatorName && (
                        <span style={{ color: '#374151' }}> · {meta.coordinatorName} → {meta.clubName}</span>
                      )}
                    </div>
                    <AuditChanges changes={meta.changes} />
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af', marginTop: 3 }}>
                      {row.user_name || 'System'}
                      {row.entity_type && <span> · {row.entity_type}</span>}
                    </div>
                  </div>

                  {/* Right: timestamp */}
                  <div style={{
                    fontSize: '0.75rem', color: '#9ca3af',
                    whiteSpace: 'nowrap', paddingTop: 2,
                  }}>
                    {timeAgo(row.created_at)}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{
              display: 'flex', justifyContent: 'center', alignItems: 'center',
              gap: 12, marginTop: 24, flexWrap: 'wrap',
            }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  border: '1.5px solid #e5e7eb',
                  background: page === 1 ? '#f9fafb' : '#fff',
                  color: page === 1 ? '#9ca3af' : '#374151',
                  cursor: page === 1 ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: '0.875rem',
                }}
              >
                ← Prev
              </button>
              <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={{
                  padding: '8px 18px', borderRadius: 8,
                  border: '1.5px solid #e5e7eb',
                  background: page === totalPages ? '#f9fafb' : '#fff',
                  color: page === totalPages ? '#9ca3af' : '#374151',
                  cursor: page === totalPages ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: '0.875rem',
                }}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
