import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import s from './CertTemplateEditor.module.css';

const ANCHOR_KEYS = ['name', 'game', 'date'];
const CHIPS = [
  { key: 'name', label: 'Name' },
  { key: 'game', label: 'Game' },
  { key: 'date', label: 'Date' },
];

/* Lets an admin upload a certificate template image and click on it to place three text
   anchors (Name / Game / Date) as % coordinates — later used server-side to overlay the
   student's registered name, the event title, and the event date onto the PDF. */
export default function CertTemplateEditor({ eventId, category, label, template, onUpdate }) {
  const [uploading, setUploading]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [armed, setArmed]             = useState(null);
  const [draftAnchors, setDraftAnchors] = useState(template?.anchors || {});
  const [error, setError]             = useState('');
  const fileRef = useRef();
  const imgRef  = useRef();

  useEffect(() => { setDraftAnchors(template?.anchors || {}); }, [template?.imageUrl]);

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('image', f);
      const { template: t } = await api.postForm(`/events/${eventId}/certificate-templates/${category}`, fd);
      onUpdate(category, t);
      setArmed(null);
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleImageClick = (e) => {
    if (!armed || !imgRef.current) return;
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setDraftAnchors(p => ({ ...p, [armed]: { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) } }));
    setArmed(null);
  };

  const handleSavePositions = async () => {
    setSaving(true); setError('');
    try {
      const { template: t } = await api.put(`/events/${eventId}/certificate-templates/${category}/anchors`, { anchors: draftAnchors });
      onUpdate(category, t);
    } catch (err) {
      setError(err.message || 'Failed to save positions.');
    } finally {
      setSaving(false);
    }
  };

  const armedChip = CHIPS.find(c => c.key === armed);
  const allPlaced = ANCHOR_KEYS.every(k => draftAnchors[k]);

  return (
    <div className={s.editor}>
      <div className={s.editorHead}>
        <span className={s.editorLabel}>{label}</span>
        {uploading && <span className={s.editorHint}>Uploading…</span>}
      </div>

      {!template?.imageUrl ? (
        <div className={s.dropzone} onClick={() => fileRef.current.click()}>
          <span>Click to upload template (JPG/PNG)</span>
        </div>
      ) : (
        <div className={s.imgWrap} onClick={handleImageClick} style={{ cursor: armed ? 'crosshair' : 'default' }}>
          <img ref={imgRef} src={template.imageUrl} alt={label} className={s.previewImg} draggable={false} />
          {CHIPS.map(c => draftAnchors[c.key] && (
            <div key={c.key} className={s.marker} style={{ left: `${draftAnchors[c.key].x}%`, top: `${draftAnchors[c.key].y}%` }}>
              <span className={s.markerDot} />
              <span className={s.markerLabel}>{c.label}</span>
            </div>
          ))}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }} onChange={handleFile} />

      {template?.imageUrl && (
        <>
          <button type="button" className={s.replaceBtn} onClick={() => fileRef.current.click()}>Replace image</button>
          <div className={s.chipsRow}>
            {CHIPS.map(c => (
              <button key={c.key} type="button"
                className={`${s.chip} ${armed === c.key ? s.chipArmed : ''} ${draftAnchors[c.key] ? s.chipSet : ''}`}
                onClick={() => setArmed(armed === c.key ? null : c.key)}>
                {c.label} {draftAnchors[c.key] ? '✓' : ''}
              </button>
            ))}
          </div>
          <div className={s.editorHintSmall}>
            {armed ? `Click on the image to place "${armedChip.label}"` : 'Select a field above, then click on the image to position it. Replacing the image clears saved positions.'}
          </div>
          <button type="button" className={s.saveBtn} onClick={handleSavePositions} disabled={saving || !allPlaced}>
            {saving ? 'Saving…' : 'Save Positions'}
          </button>
        </>
      )}

      {error && <div className={s.error}>{error}</div>}
    </div>
  );
}
