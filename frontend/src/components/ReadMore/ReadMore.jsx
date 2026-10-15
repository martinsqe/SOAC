import { useState } from 'react';

/* Long description cut to `limit` characters with an inline "…read more"
   that expands the full text in place (and "show less" to collapse it). */
export default function ReadMore({ text, limit = 150, as = 'p', className, style }) {
  const [open, setOpen] = useState(false);
  const Tag = as;
  if (!text) return null;
  const full = String(text).trim();
  const long = full.length > limit;
  let preview = full.slice(0, limit);
  const cut = preview.lastIndexOf(' ');
  if (cut > limit * 0.6) preview = preview.slice(0, cut);
  preview = preview.replace(/[\s.,;:!?-]+$/, '');
  return (
    <Tag className={className} style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere', ...style }}>
      {open || !long ? full : preview + '…'}
      {long && (
        <>
          {' '}
          <button type="button" aria-expanded={open}
            onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(o => !o); }}
            style={{ border: 'none', background: 'none', padding: 0, font: 'inherit', fontWeight: 700, color: '#635BFF', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {open ? 'show less' : 'read more'}
          </button>
        </>
      )}
    </Tag>
  );
}
