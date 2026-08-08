import { useState } from 'react';
import { getPushDebugLog, clearPushDebugLog } from '../../utils/debugLog';

/* Temporary on-device diagnostic panel for the push notification pipeline —
   lets the log be read directly off a phone screen when remote debugging
   (chrome://inspect, wireless ADB) isn't available or won't connect. Safe to
   delete once push is confirmed working reliably across target devices. */
export default function PushDebugPanel() {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState([]);

  const show = () => {
    setLog(getPushDebugLog());
    setOpen(true);
  };

  return (
    <>
      <button
        onClick={show}
        style={{
          position: 'fixed', bottom: 16, right: 16, zIndex: 9999,
          width: 40, height: 40, borderRadius: '50%', border: 'none',
          background: '#1f2937', color: '#fff', fontSize: 18,
          boxShadow: '0 4px 14px rgba(0,0,0,0.3)', cursor: 'pointer',
        }}
        title="Push debug log"
      >
        🐞
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 10001,
            background: 'rgba(0,0,0,0.6)', display: 'flex',
            alignItems: 'flex-end', padding: 0,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#111827', color: '#e5e7eb', width: '100%',
              maxHeight: '75vh', overflowY: 'auto', borderRadius: '16px 16px 0 0',
              padding: 16, fontFamily: 'monospace', fontSize: 11.5,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <strong style={{ color: '#fff', fontSize: 13 }}>Push Debug Log</strong>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => { clearPushDebugLog(); setLog([]); }}
                  style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                >
                  Clear
                </button>
                <button
                  onClick={() => setOpen(false)}
                  style={{ background: '#374151', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}
                >
                  Close
                </button>
              </div>
            </div>
            {log.length === 0 ? (
              <div style={{ color: '#6b7280' }}>No log entries yet — reload the page to capture a fresh sync attempt.</div>
            ) : (
              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {log.join('\n')}
              </pre>
            )}
          </div>
        </div>
      )}
    </>
  );
}
