/* Renders the About Galore text as a short document: "## " lines become
   headings, "- Label: text" lines become a bulleted list, and blank lines
   separate paragraphs. Format is described in utils/galoreAbout.js. */

const h3   = { fontSize: '1rem', fontWeight: 800, color: '#b91c1c', margin: '22px 0 6px' };
const para = { fontSize: '.92rem', color: '#374151', lineHeight: 1.65, margin: '0 0 10px' };
const lead = { ...para, fontSize: '1rem', color: '#1f2937', fontWeight: 500 };
const list = { margin: '4px 0 12px', paddingLeft: 20, display: 'grid', gap: 6 };

function blocks(text) {
  const out = [];
  let para = [], items = [];
  const flushPara = () => { if (para.length) { out.push({ t: 'p', v: para.join(' ') }); para = []; } };
  const flushList = () => { if (items.length) { out.push({ t: 'ul', v: items }); items = []; } };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flushPara(); flushList(); }
    else if (line.startsWith('## ')) { flushPara(); flushList(); out.push({ t: 'h', v: line.slice(3).trim() }); }
    else if (/^[-•]\s+/.test(line)) { flushPara(); items.push(line.replace(/^[-•]\s+/, '')); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out;
}

function Item({ text }) {
  const i = text.indexOf(':');
  if (i > 0 && i < 40) return <li style={para}><strong style={{ color: '#111827' }}>{text.slice(0, i)}</strong>{text.slice(i)}</li>;
  return <li style={para}>{text}</li>;
}

export default function AboutText({ text, align = 'center' }) {
  const bs = blocks(text);
  const centered = align === 'center';
  const ulStyle = centered ? { ...list, listStyle: 'none', paddingLeft: 0, textAlign: 'center' } : list;
  return (
    <div style={{ textAlign: align, maxWidth: 760, margin: centered ? '12px auto 0' : '12px 0 0' }}>
      {bs.map((b, i) =>
        b.t === 'h'  ? <h3 key={i} style={h3}>{b.v}</h3>
        : b.t === 'ul' ? <ul key={i} style={ulStyle}>{b.v.map((x, j) => <Item key={j} text={x} />)}</ul>
        : <p key={i} style={i === 0 ? lead : para}>{b.v}</p>
      )}
    </div>
  );
}
