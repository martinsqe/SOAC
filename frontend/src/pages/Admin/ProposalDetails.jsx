/* Everything a proposer submitted for a new club, shown read-only. Shared by
   the Approvals page (full application view) and the Clubs page (reference
   panel while admin verifies the pre-filled Create Club form). */

const SECTIONS = [
  ['applicant',    'Primary Applicant', '🎓'],
  ['advisor',      'Faculty Advisor',   '👩‍🏫'],
  ['coordinator',  'Coordinator',       '👥'],
  ['organization', 'Organization',      '🏛️'],
  ['plan',         'Activity Plan',     '📅'],
];

const isLink = (v) => /^https?:\/\//.test(v);

function Field({ label, value, wide }) {
  if (!value) return null;
  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined, minWidth: 0 }}>
      <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:'#9ca3af', marginBottom:2 }}>
        {label}
      </div>
      <div style={{ fontSize:13.5, color:'#111827', lineHeight:1.5, whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
        {isLink(value)
          ? <a href={value} target="_blank" rel="noopener noreferrer" style={{ color:'#635BFF', fontWeight:600 }}>Open link ↗</a>
          : value}
      </div>
    </div>
  );
}

function Card({ title, icon, children }) {
  return (
    <div style={{ border:'1px solid #ece9fb', borderRadius:14, padding:'14px 16px', background:'#fff' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
        <span style={{ fontSize:15 }}>{icon}</span>
        <span style={{ fontSize:12, fontWeight:800, letterSpacing:'.04em', textTransform:'uppercase', color:'#4c44d4' }}>{title}</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:'12px 16px' }}>
        {children}
      </div>
    </div>
  );
}

export default function ProposalDetails({ p }) {
  const d = p.details || {};
  const reasonDiffers = p.reason && p.reason !== p.vision;
  const longKeys = /co-applicants|advisors|events|resource|details|frequency/i;

  return (
    <div style={{ display:'grid', gap:12 }}>
      <Card title="About the Club" icon="✨">
        <Field label="Category"      value={p.category && p.category[0].toUpperCase() + p.category.slice(1)} />
        <Field label="Founded"       value={p.founded_year} />
        <Field label="Tags"          value={(p.tags || []).join(', ')} />
        <Field label="Description"   value={p.description} wide />
        <Field label="Vision / Objectives" value={p.vision} wide />
        {reasonDiffers && <Field label="Why this club?" value={p.reason} wide />}
        <Field label="Schedule"      value={p.schedule} wide />
        <Field label="Proposed Rules" value={(p.rules || []).map((r, i) => `${i + 1}. ${r}`).join('\n')} wide />
      </Card>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:12 }}>
        {SECTIONS.map(([key, title, icon]) => d[key] && Object.keys(d[key]).length > 0 && (
          <Card key={key} title={title} icon={icon}>
            {Object.entries(d[key]).map(([k, v]) => (
              <Field key={k} label={k} value={v} wide={longKeys.test(k) || v.length > 60} />
            ))}
          </Card>
        ))}
      </div>

      {p.admin_note && (
        <div style={{ padding:'10px 14px', background:'#fef9c3', borderRadius:12, fontSize:13, color:'#854d0e' }}>
          <strong>Admin note:</strong> {p.admin_note}
        </div>
      )}
    </div>
  );
}
