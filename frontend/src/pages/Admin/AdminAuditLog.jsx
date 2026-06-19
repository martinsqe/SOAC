import { useState, useEffect } from 'react';
import api from '../../api/client';

const ACTION_MAP = {
  CREATE_CLUB:        { label: 'Club created',         color: '#22c55e', bg: '#f0fdf4' },
  UPDATE_CLUB:        { label: 'Club updated',         color: '#3b82f6', bg: '#eff6ff' },
  DELETE_CLUB:        { label: 'Club removed',         color: '#ef4444', bg: '#fef2f2' },
  CREATE_EVENT:       { label: 'Event created',        color: '#22c55e', bg: '#f0fdf4' },
  UPDATE_EVENT:       { label: 'Event updated',        color: '#3b82f6', bg: '#eff6ff' },
  DELETE_EVENT:       { label: 'Event removed',        color: '#ef4444', bg: '#fef2f2' },
  CREATE_USER:        { label: 'User added',           color: '#8b5cf6', bg: '#f5f3ff' },
  ASSIGN_COORDINATOR: { label: 'Coordinator assigned', color: '#f59e0b', bg: '#fffbeb' },
  ASSIGN_CLUB:        { label: 'Club assigned',        color: '#f59e0b', bg: '#fffbeb' },
};

const TRUNC = 90;
const trunc = (str) => str && str.length > TRUNC ? str.slice(0, TRUNC) + '…' : (str || '—');

function AuditChanges({ changes }) {
  if (!changes?.length) return null;
  return (
    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {changes.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 5, fontSize: '.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: '#7b6fa0', flexShrink: 0 }}>{c.field}:</span>
          {c.from
            ? <span style={{ color: '#b0a8cc', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trunc(c.from)}</span>
            : null}
          {c.from
            ? <span style={{ color: '#c4b5fd', flexShrink: 0 }}>→</span>
            : <span style={{ color: '#c4b5fd', flexShrink: 0 }}>set to</span>}
          <span style={{ color: '#1a1040', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trunc(c.to)}</span>
        </div>
      ))}
    </div>
  );
}

const timeAgo = (iso) => {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60)    return `${secs}s ago`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

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
        setTotal(d.total || 0);
        setError('');
      })
      .catch(err => setError(err.message || 'Failed to load audit log.'))
      .finally(() => setLoading(false));
  }, [page]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{
          margin: 0, fontFamily: 'Plus Jakarta Sans, sans-serif',
          fontWeight: 900, fontSize: '1.5rem', color: '#0f0a2e',
        }}>
          📋 Audit Log
        </h1>
        <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: '.9rem' }}>
          Full history of all admin and coordinator actions on the platform
          {total > 0 && <> · {total} total entries</>}
        </p>
      </div>

      {error && (
        <div style={{
          background: '#fff0f0', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '14px 18px', color: '#b91c1c', marginBottom: 20, fontSize: 14,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{
              height: 62, borderRadius: 12, background: '#f3f4f6',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          ))}
        </div>
      ) : log.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: '#f8f7ff', borderRadius: 16, border: '2px dashed #e0deff',
        }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 700, color: '#1a1040', marginBottom: 6 }}>No audit entries yet</div>
          <p style={{ color: '#6b7280', fontSize: '.875rem' }}>
            Admin and coordinator actions will be recorded here.
          </p>
        </div>
      ) : (
        <>
          <div style={{
            background: '#fff', borderRadius: 16,
            border: '1px solid #f0f0f5', overflow: 'hidden',
            boxShadow: '0 1px 8px rgba(0,0,0,.06)',
          }}>
            {log.map((row, i) => {
              const info = ACTION_MAP[row.action] || {
                label: row.action, color: '#7b6fa0', bg: '#f9f9f9',
              };
              const meta = row.meta
                ? (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta)
                : {};

              return (
                <div key={row.id || i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 14,
                  padding: '14px 20px',
                  borderBottom: i < log.length - 1 ? '1px solid #f3f4f6' : 'none',
                  transition: 'background .15s',
                }}>
                  {/* Body */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '.875rem', lineHeight: 1.4 }}>
                      <span style={{ color: info.color, fontWeight: 700 }}>{info.label}</span>
                      {(meta.name || meta.title || meta.email) && (
                        <span style={{ color: '#374151' }}> · {meta.name || meta.title || meta.email}</span>
                      )}
                      {meta.coordinatorName && (
                        <span style={{ color: '#374151' }}> · {meta.coordinatorName} → {meta.clubName}</span>
                      )}
                    </div>
                    <AuditChanges changes={meta.changes} />
                    <div style={{ fontSize: '.78rem', color: '#9ca3af', marginTop: 4 }}>
                      {row.user_name || 'System'}
                      {row.entity_type && <> · {row.entity_type}</>}
                    </div>
                  </div>

                  {/* Time */}
                  <div style={{
                    fontSize: '.78rem', color: '#9ca3af',
                    whiteSpace: 'nowrap', flexShrink: 0,
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
              gap: 12, marginTop: 24,
            }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: '1.5px solid #e5e7eb',
                  background: page === 1 ? '#f9fafb' : '#fff',
                  color: page === 1 ? '#9ca3af' : '#374151',
                  cursor: page === 1 ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: '.875rem',
                }}
              >← Prev</button>
              <span style={{ fontSize: '.875rem', color: '#6b7280' }}>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: '1.5px solid #e5e7eb',
                  background: page === totalPages ? '#f9fafb' : '#fff',
                  color: page === totalPages ? '#9ca3af' : '#374151',
                  cursor: page === totalPages ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: '.875rem',
                }}
              >Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
