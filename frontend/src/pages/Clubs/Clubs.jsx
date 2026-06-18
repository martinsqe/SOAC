import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useStats } from '../../context/StatsContext';
import styles from './Clubs.module.css';
import JoinModal from '../../components/JoinModal/JoinModal';

/* ── Club data (all 40 logos mapped) ─────────────────── */
const ALL_CLUBS = [
  // Sports
  { logo: 'ZERO VIOLATION BASKETBALL CLUB.png', name: 'IRONCREED',                        cat: 'sports',   color: '#FF4757', members: 72,  events: 3, coord: 'Coach Ramesh Iyer',    yr: '2015' },
  { logo: 'RKU RANGERS.png',                    name: 'RKU Rangers FC',                   cat: 'sports',   color: '#00C896', members: 84,  events: 4, coord: 'Coach Devraj Singh',   yr: '2013' },
  { logo: 'RKU SHUTTLE SMASHERS.png',           name: 'RKU Shuttle Smashers',             cat: 'sports',   color: '#00AADD', members: 60,  events: 3, coord: 'Prof. Ritesh Patel',   yr: '2016' },
  { logo: 'RKU VOLLEY AVENGERS.png',            name: 'RKU Volley Avengers',              cat: 'sports',   color: '#E25600', members: 55,  events: 3, coord: 'Coach Ravi Bose',      yr: '2018' },
  { logo: 'Kabaddi Warriors Club logo.png',     name: 'Kabaddi Warriors',                 cat: 'sports',   color: '#9B2335', members: 48,  events: 2, coord: 'Prof. Sunil Desai',    yr: '2019' },
  { logo: 'Powerhouse Club logo.png',           name: 'Powerhouse Fitness Club',          cat: 'sports',   color: '#06D6A0', members: 63,  events: 4, coord: 'Dr. Kavya Iyer',       yr: '2022' },
  { logo: 'RISING STAR.png',                    name: 'Rising Star Cricket Club',         cat: 'sports',   color: '#C7522A', members: 76,  events: 4, coord: 'Coach Navin Shah',     yr: '2014' },
  { logo: 'THE KING OF 64.png',                 name: 'The King of 64 — Chess',           cat: 'sports',   color: '#9CA3AF', members: 48,  events: 3, coord: 'Prof. Mohan Rao',      yr: '2014' },
  // Cultural
  { logo: 'BUMBLEBEEZ.png',                     name: 'Bumblebeez',                       cat: 'cultural', color: '#FFD166', members: 39,  events: 3, coord: 'Prof. Kavya Menon',    yr: '2018' },
  { logo: 'SOUL OF MUSIC.png',                  name: 'Soul of Music',                    cat: 'cultural', color: '#FF9500', members: 68,  events: 4, coord: 'Dr. Arjun Pillai',     yr: '2015' },
  { logo: 'KALARAW.png',                        name: 'Kalaraw Club',                     cat: 'cultural', color: '#FF6B9D', members: 53,  events: 3, coord: 'Dr. Leela Krishnan',   yr: '2017' },
  { logo: 'PICTZA.png',                         name: 'Pictza Club',                      cat: 'cultural', color: '#A259FF', members: 47,  events: 2, coord: 'Prof. Meera Singh',    yr: '2019' },
  // Social
  { logo: 'SHWET THE RISE OF HUMANITY.png',    name: 'SHWET — Rise of Humanity',         cat: 'social',   color: '#FF6B9D', members: 56,  events: 4, coord: 'Dr. Ananya Roy',       yr: '2016' },
  // Academic
  { logo: 'ANDROID DEVLOPMENT CLUB.png',        name: 'Android Development Club',         cat: 'academic', color: '#3DDC84', members: 98,  events: 4, coord: 'Prof. Anita Mehta',    yr: '2019' },
  { logo: 'WEBIFY.png',                         name: 'Webify Club',                      cat: 'academic', color: '#635BFF', members: 74,  events: 3, coord: 'Dr. Rajesh Pillai',    yr: '2020' },
  { logo: 'iOS DEVLOPMENT CLUB.png',            name: 'iOS Development Club',             cat: 'academic', color: '#007AFF', members: 52,  events: 2, coord: 'Prof. Sneha Mehta',    yr: '2021' },
  { logo: 'MOZILLA.png',                        name: 'Mozilla Club',                     cat: 'academic', color: '#FF6611', members: 61,  events: 3, coord: 'Dr. Vinod Rao',        yr: '2018' },
  { logo: 'IOT Club logo.png',                  name: 'IoT Club',                         cat: 'academic', color: '#00B5A3', members: 57,  events: 3, coord: 'Prof. Arun Kumar',      yr: '2020' },
  { logo: 'IMAGINATION TO IMPLEMENTATION.png',  name: 'Imagination to Implementation',   cat: 'academic', color: '#A259FF', members: 45,  events: 2, coord: 'Prof. Divya Nair',     yr: '2022' },
  { logo: 'CHANGE MAKERS E-CELL.png',           name: 'Change Makers E-Cell',             cat: 'academic', color: '#FF9500', members: 87,  events: 5, coord: 'Dr. Kiran Sharma',     yr: '2017' },
  { logo: 'BHASHA.png',                         name: 'BHASHA Club',                      cat: 'academic', color: '#635BFF', members: 44,  events: 2, coord: 'Prof. Bharat Rao',     yr: '2018' },
  { logo: 'BREATHS & BEATS.png',                name: 'Breaths & Beats',                  cat: 'academic', color: '#FF6B9D', members: 41,  events: 3, coord: 'Prof. Nisha Menon',    yr: '2019' },
  { logo: 'GOBBLER\'S GANG.png',                name: "Gobbler's Gang",                   cat: 'academic', color: '#F0A500', members: 35,  events: 2, coord: 'Prof. Rahul Joshi',    yr: '2020' },
  { logo: 'RANG MANCH.png',                     name: 'Rang Manch',                       cat: 'academic', color: '#D32F2F', members: 50,  events: 3, coord: 'Dr. Pooja Sharma',     yr: '2016' },
  { logo: 'AERO MODELLING.png',                 name: 'Aero Modelling Club',              cat: 'academic', color: '#00C8FF', members: 34,  events: 2, coord: 'Prof. Suresh Iyer',    yr: '2019' },
  { logo: 'NIRMAAN.png',                        name: 'Club Nirmaan',                     cat: 'academic', color: '#FF9500', members: 61,  events: 2, coord: 'Dr. Rahul Verma',      yr: '2016' },
  { logo: 'PRODUCT DESIGN.png',                 name: 'Product Design Club',              cat: 'academic', color: '#A259FF', members: 42,  events: 2, coord: 'Prof. Riya Das',       yr: '2020' },
  { logo: 'PHARMA HEALTH CLUB.png',             name: 'Pharma Health Club',               cat: 'academic', color: '#00C896', members: 55,  events: 3, coord: 'Dr. Preethi Nair',    yr: '2018' },
  { logo: 'PARKINSON DISEASE SUPPORT GROUP.png', name: 'Parkinson Disease Support',       cat: 'academic', color: '#635BFF', members: 31,  events: 2, coord: 'Dr. Sunita Kumar',    yr: '2020' },
  { logo: 'RAJKOT KNEE CLUB.png',               name: 'Rajkot Knee Club',                cat: 'academic', color: '#FF6B9D', members: 28,  events: 2, coord: 'Dr. Anil Mehta',      yr: '2021' },
  { logo: 'MICROBIOLOGIST CLUB.png',            name: 'Microbiologist Club',              cat: 'academic', color: '#635BFF', members: 43,  events: 2, coord: 'Prof. Kavitha Bose',  yr: '2019' },
  { logo: 'MEDICINAL PLANTS CLUB.png',          name: 'Medicinal Plants Club',            cat: 'academic', color: '#00C896', members: 38,  events: 2, coord: 'Prof. Sneha Rao',     yr: '2020' },
  { logo: 'AYUSHAMRIT.png',                     name: 'Ayushamrit Club',                  cat: 'academic', color: '#4B6E2E', members: 35,  events: 2, coord: 'Dr. Vijay Pillai',    yr: '2021' },
  { logo: 'GSG Club Logo.png',                  name: 'GSG Club',                         cat: 'academic', color: '#4B6E2E', members: 120, events: 6, coord: 'Lt. Col. V. Desai',   yr: '2010' },
  { logo: 'SAPIENS THE HR CLUB.png',            name: 'Sapiens — The HR Club',            cat: 'academic', color: '#A259FF', members: 57,  events: 3, coord: 'Prof. Aditi Sharma',  yr: '2019' },
  { logo: 'UNITE.png',                          name: 'Unite Club',                       cat: 'academic', color: '#FF6B9D', members: 49,  events: 3, coord: 'Dr. Priya Menon',     yr: '2020' },
  { logo: 'SETU - MUN.png',                     name: 'SETU — MUN',                       cat: 'academic', color: '#635BFF', members: 66,  events: 4, coord: 'Prof. Sanjay Ghosh',  yr: '2018' },
  { logo: 'WOMEN WONDERS.png',                  name: 'Women Wonders',                    cat: 'academic', color: '#FF6B9D', members: 74,  events: 4, coord: 'Dr. Rekha Iyer',      yr: '2017' },
  { logo: 'KNOW YOUR FINANCE.png',              name: 'Know Your Finance',                cat: 'academic', color: '#FF9500', members: 66,  events: 4, coord: 'Dr. Rohan Shah',      yr: '2017' },
  { logo: 'MATHEMAGICIANS.png',                 name: 'Mathemagicians',                   cat: 'academic', color: '#635BFF', members: 52,  events: 3, coord: 'Prof. Anika Joshi',   yr: '2018' },
];

const CAT_LABELS = {
  all:      'All',
  sports:   '⚽ Sports',
  cultural: '🎭 Cultural',
  social:   '🤝 Social',
  academic: '🎓 Academic',
};

const CAT_COLORS = {
  sports:   '#FF4757',
  cultural: '#FF6B9D',
  social:   '#06D6A0',
  academic: '#635BFF',
};

/* ── Propose Club Modal (5-step) ─────────────────────── */
const STEPS = ['Applicant Info', 'Advisor & Team', 'Club Details', 'Activity Plan', 'Review & Submit'];

const ProposeModal = ({ onClose }) => {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    clubName: '', orgType: '', affiliation: '', extName: '', extDetail: '',
    fname: '', lname: '', enroll: '', term: '', school: '', branch: '', email: '', phone: '', otherApplicants: '',
    advFname: '', advLname: '', advSchool: '', advDept: '', advSpec: '', advExp: '', advEmail: '', advPhone: '', advConsent: '', otherAdvisors: '',
    coordFname: '', coordLname: '', coordSchool: '', coordBranch: '', coordEnroll: '', coordEmail: '',
    clubDesc: '', clubObjectives: '', clubSize: '', clubCategory: '',
    meetingFreq: '', eventPlan: '', resourceReq: '',
  });
  const [submitted,  setSubmitted]  = useState(false);
  const [stepError,  setStepError]  = useState('');

  const validate = (s) => {
    if (s === 1) {
      if (!form.clubName.trim())   return 'Club / Organization name is required.';
      if (!form.orgType)           return 'Type of Organization is required.';
      if (!form.affiliation)       return 'Nature of Affiliation is required.';
      if (!form.fname.trim())      return 'First name is required.';
      if (!form.lname.trim())      return 'Last name is required.';
      if (!form.enroll.trim())     return 'Enrollment number is required.';
      if (!form.term.trim())       return 'Academic term is required.';
      if (!form.school.trim())     return 'School / Faculty is required.';
      if (!form.branch.trim())     return 'Branch / Program is required.';
      if (!form.email.trim())      return 'Email address is required.';
      if (!form.email.includes('@')) return 'Enter a valid email address.';
      if (!form.phone.trim())      return 'Contact number is required.';
    }
    if (s === 2) {
      if (!form.advFname.trim())   return "Advisor first name is required.";
      if (!form.advLname.trim())   return "Advisor last name is required.";
      if (!form.advSchool.trim())  return "Advisor school is required.";
      if (!form.advDept.trim())    return "Advisor department is required.";
      if (!form.advEmail.trim())   return "Advisor email is required.";
      if (!form.advEmail.includes('@')) return "Enter a valid advisor email.";
    }
    if (s === 3) {
      if (!form.clubDesc.trim())      return 'Club description is required.';
      if (!form.clubObjectives.trim()) return 'Club objectives are required.';
      if (!form.clubCategory)         return 'Category is required.';
      if (!form.clubSize.trim())      return 'Expected membership size is required.';
    }
    if (s === 4) {
      if (!form.meetingFreq.trim()) return 'Meeting frequency & schedule is required.';
      if (!form.eventPlan.trim())   return 'Planned events for the first year are required.';
    }
    return '';
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inp = (id, ph, type = 'text') => (
    <input
      type={type}
      placeholder={ph}
      value={form[id]}
      onChange={e => set(id, e.target.value)}
      className={styles.minp}
    />
  );
  const lbl = (text, req) => (
    <label className={styles.mlbl}>{text}{req && <span className={styles.mreq}>*</span>}</label>
  );
  const field = (label, id, ph, type, req) => (
    <div>
      {lbl(label, req)}
      {inp(id, ph, type)}
    </div>
  );
  const g2 = (children) => <div className={styles.mg2}>{children}</div>;

  const handleSubmit = () => setSubmitted(true);

  if (submitted) return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.mSuccess}>
          <div className={styles.mSuccessIcon}>✅</div>
          <h3>Application Submitted!</h3>
          <p>Your club proposal has been received. SOAC will review it and contact you within 5-7 working days.</p>
          <button className="btr" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.mhead}>
          <div>
            <div className={styles.mheadTag}>SOAC Club Application</div>
            <h2 className={styles.mheadTitle}>Propose a New Club</h2>
          </div>
          <button className={styles.mclose} onClick={onClose}>✕</button>
        </div>

        {/* Step indicators */}
        <div className={styles.msteps}>
          {STEPS.map((s, i) => (
            <React.Fragment key={i}>
              <div
                className={`${styles.mstep} ${step === i + 1 ? styles.mstepActive : ''} ${step > i + 1 ? styles.mstepDone : ''}`}
                onClick={() => step > i + 1 && setStep(i + 1)}
              >
                <div className={styles.msdot}>{step > i + 1 ? '✓' : i + 1}</div>
                <span className={styles.mslabel}>{s}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`${styles.msline} ${step > i + 1 ? styles.mslineDone : ''}`} />}
            </React.Fragment>
          ))}
        </div>

        {/* Body */}
        <div className={styles.mbody}>
          {step === 1 && (
            <div>
              <div className={styles.mpartTitle}>Part A — Applicant Information</div>
              <p className={styles.mpartSub}>Tell us about the proposed organization and the lead applicant.</p>
              <div className={styles.mfields}>
                {field('Proposed Club / Organization Name', 'clubName', 'e.g. Robotics & Automation Club', 'text', true)}
                {g2(<>
                  <div>
                    {lbl('Type of Organization', true)}
                    <select className={styles.minp} value={form.orgType} onChange={e => set('orgType', e.target.value)}>
                      <option value="">Select type</option>
                      <option>Academic</option>
                      <option>Cultural</option>
                      <option>Social</option>
                      <option>Sports</option>
                    </select>
                  </div>
                  <div>
                    {lbl('Nature of Affiliation', true)}
                    <select className={styles.minp} value={form.affiliation} onChange={e => set('affiliation', e.target.value)}>
                      <option value="">Select</option>
                      <option>Independent (new)</option>
                      <option>Extension of existing organization</option>
                    </select>
                  </div>
                </>)}
                {form.affiliation === 'Extension of existing organization' && (
                  <>
                    {field('Parent Institute / Organization Name', 'extName', 'e.g. IEEE India', 'text', false)}
                    <div>
                      {lbl('Details of Parent Organization')}
                      <textarea className={styles.minp} placeholder="Brief description..." rows={3} value={form.extDetail} onChange={e => set('extDetail', e.target.value)} />
                    </div>
                  </>
                )}
                <div className={styles.msub}>Primary Student Applicant</div>
                {g2(<>
                  {field('First Name', 'fname', '', 'text', true)}
                  {field('Last Name', 'lname', '', 'text', true)}
                </>)}
                {g2(<>
                  {field('Enrollment Number', 'enroll', 'e.g. 22BCE001', 'text', true)}
                  {field('Academic Term', 'term', 'e.g. 2024-2025', 'text', true)}
                </>)}
                {g2(<>
                  {field('School / Faculty', 'school', 'e.g. School of Computing Sciences', 'text', true)}
                  {field('Branch / Program', 'branch', 'e.g. B.Tech Computer Science', 'text', true)}
                </>)}
                {g2(<>
                  {field('Email Address', 'email', 'your@rku.ac.in', 'email', true)}
                  {field('Contact Number', 'phone', '+91 XXXXX XXXXX', 'tel', true)}
                </>)}
                <div>
                  {lbl('Other Co-Applicants (optional)')}
                  <textarea className={styles.minp} placeholder="Name, Enrollment No, School — one per line" rows={3} value={form.otherApplicants} onChange={e => set('otherApplicants', e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <div className={styles.mpartTitle}>Part B — Advisor & Leadership Team</div>
              <p className={styles.mpartSub}>Every SOAC club requires a Faculty Advisor. All three leadership roles are mandatory.</p>
              <div className={styles.mCard}>
                <div className={styles.mCardLabel} style={{ color: '#635BFF' }}>🎓 Primary Faculty Advisor</div>
                <div className={styles.mfields}>
                  {g2(<>
                    {field('First Name', 'advFname', '', 'text', true)}
                    {field('Last Name', 'advLname', '', 'text', true)}
                  </>)}
                  {g2(<>
                    {field('School', 'advSchool', '', 'text', true)}
                    {field('Department', 'advDept', '', 'text', true)}
                  </>)}
                  {g2(<>
                    {field('Specialization', 'advSpec', 'e.g. Machine Learning', 'text', false)}
                    {field('Total Experience', 'advExp', 'e.g. 8 years', 'text', false)}
                  </>)}
                  {g2(<>
                    {field('Email Address', 'advEmail', '', 'email', true)}
                    {field('Contact Number', 'advPhone', '', 'tel', false)}
                  </>)}
                  <div>
                    {lbl('Faculty Consent Letter (Google Drive link)')}
                    {inp('advConsent', 'https://drive.google.com/...', 'url')}
                    <p className={styles.mhint}>Upload advisor's signed consent letter to Google Drive and paste the link</p>
                  </div>
                  <div>
                    {lbl('Other Faculty Advisors (optional)')}
                    <textarea className={styles.minp} placeholder="Name, Department — one per line" rows={3} value={form.otherAdvisors} onChange={e => set('otherAdvisors', e.target.value)} />
                  </div>
                </div>
              </div>
              <div className={styles.mCard}>
                <div className={styles.mCardLabel} style={{ color: '#3DDC84' }}>👥 Coordinator</div>
                <div className={styles.mg2}>
                  {field('First Name', 'coordFname', 'First name', 'text', false)}
                  {field('Last Name', 'coordLname', 'Last name', 'text', false)}
                  {field('School / Faculty', 'coordSchool', 'e.g. School of Computing', 'text', false)}
                  {field('Branch / Program', 'coordBranch', 'e.g. B.Tech CSE', 'text', false)}
                  {field('Enrollment No', 'coordEnroll', 'e.g. 22BCE001', 'text', false)}
                  {field('Email Address', 'coordEmail', 'student@rku.ac.in', 'email', false)}
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className={styles.mpartTitle}>Part C — Club Details</div>
              <p className={styles.mpartSub}>Describe the purpose and scope of the proposed club.</p>
              <div className={styles.mfields}>
                <div>
                  {lbl('Club Description', true)}
                  <textarea className={styles.minp} placeholder="Describe what this club is about, its vision and what it offers to students..." rows={4} value={form.clubDesc} onChange={e => set('clubDesc', e.target.value)} />
                </div>
                <div>
                  {lbl('Club Objectives', true)}
                  <textarea className={styles.minp} placeholder="List the key objectives of this club (one per line)..." rows={4} value={form.clubObjectives} onChange={e => set('clubObjectives', e.target.value)} />
                </div>
                {g2(<>
                  <div>
                    {lbl('Category', true)}
                    <select className={styles.minp} value={form.clubCategory} onChange={e => set('clubCategory', e.target.value)}>
                      <option value="">Select category</option>
                      <option>Academic</option>
                      <option>Cultural</option>
                      <option>Social</option>
                      <option>Sports</option>
                    </select>
                  </div>
                  {field('Expected Initial Membership', 'clubSize', 'e.g. 30-50 students', 'text', true)}
                </>)}
              </div>
            </div>
          )}

          {step === 4 && (
            <div>
              <div className={styles.mpartTitle}>Part D — Activity Plan</div>
              <p className={styles.mpartSub}>Outline the club's planned activities and resource requirements.</p>
              <div className={styles.mfields}>
                <div>
                  {lbl('Meeting Frequency & Schedule', true)}
                  <textarea className={styles.minp} placeholder="e.g. Weekly on Fridays at 4pm in Lab 203..." rows={3} value={form.meetingFreq} onChange={e => set('meetingFreq', e.target.value)} />
                </div>
                <div>
                  {lbl('Planned Events for First Year', true)}
                  <textarea className={styles.minp} placeholder="List events you plan to organise — workshops, competitions, guest lectures..." rows={4} value={form.eventPlan} onChange={e => set('eventPlan', e.target.value)} />
                </div>
                <div>
                  {lbl('Resource Requirements')}
                  <textarea className={styles.minp} placeholder="Space, equipment, budget estimate, any university support needed..." rows={3} value={form.resourceReq} onChange={e => set('resourceReq', e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div>
              <div className={styles.mpartTitle}>Part E — Review & Submit</div>
              <p className={styles.mpartSub}>Review your application before submitting to SOAC.</p>
              <div className={styles.mreview}>
                {[
                  { label: 'Club Name', value: form.clubName },
                  { label: 'Category', value: form.orgType },
                  { label: 'Applicant', value: `${form.fname} ${form.lname}` },
                  { label: 'Enrollment', value: form.enroll },
                  { label: 'School', value: form.school },
                  { label: 'Email', value: form.email },
                  { label: 'Faculty Advisor', value: `${form.advFname} ${form.advLname}` },
                  { label: 'Coordinator', value: `${form.coordFname} ${form.coordLname}` },
                ].map(r => r.value?.trim() ? (
                  <div key={r.label} className={styles.mrvrow}>
                    <span className={styles.mrvlabel}>{r.label}</span>
                    <span className={styles.mrvval}>{r.value}</span>
                  </div>
                ) : null)}
              </div>
              <div className={styles.mDecl}>
                <p>By submitting this application I confirm that all information provided is accurate and that I have read and agree to the SOAC Club Constitution & Bylaws.</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.mfoot}>
          {step > 1 && (
            <button className={styles.mbtnBack} onClick={() => { setStepError(''); setStep(s => s - 1); }}>← Back</button>
          )}
          {stepError && (
            <span style={{ flex: 1, fontSize: 12, color: '#c0002e', fontWeight: 600, paddingRight: 8 }}>
              ⚠ {stepError}
            </span>
          )}
          {!stepError && <span style={{ flex: 1 }} />}
          {step < 5
            ? <button className="btr" onClick={() => {
                const err = validate(step);
                if (err) { setStepError(err); return; }
                setStepError('');
                setStep(s => s + 1);
              }}>Continue →</button>
            : <button className="btr" onClick={handleSubmit}>Submit Application</button>
          }
        </div>
      </div>
    </div>
  );
};

/* JoinModal is now a shared component — imported at the top */

/* ── Main Clubs Page ─────────────────────────────────── */
/* Normalise API club objects to match the existing component shape */
const normalise = (c) => ({
  logo:     c.logo || '',
  name:     c.name,
  cat:      c.category,
  color:    c.color || '#635BFF',
  members:  c.memberCount,
  events:   c.eventCount,
  coord:    c.coordinator,
  yr:       c.foundedYear,
  desc:     c.description || '',
  _id:      c._id,
  /* logoUrl is pre-computed by the backend controller */
  _apiLogo: c.logoUrl || null,
});

const Clubs = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { clubs: totalFromStats } = useStats();
  const [filter,    setFilter]    = useState('all');
  const [search,    setSearch]    = useState('');
  const [showModal,    setShowModal]    = useState(false);
  const [joiningClub,  setJoiningClub]  = useState(null);
  const [clubs, setClubs] = useState(ALL_CLUBS); // static shown instantly; replaced when API responds

  useEffect(() => {
    fetch('/api/clubs')
      .then(r => r.json())
      .then(d => { if (d.clubs?.length) setClubs(d.clubs.map(normalise)); })
      .catch(() => {}); // silently keep static fallback on error
  }, []);

  const matchesSearch = (c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (CAT_LABELS[c.cat] || '').toLowerCase().includes(q) ||
      (c.coord || '').toLowerCase().includes(q)
    );
  };

  const filtered = clubs.filter(c =>
    (filter === 'all' || c.cat === filter) && matchesSearch(c)
  );

  // Observer only handles hero/title fade elements — cards use CSS animation instead
  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('in'); });
    }, { threshold: 0.06 });
    document.querySelectorAll('.fade').forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  return (
    <div className={styles.clubs}>

      {/* ── HERO / TOP ── */}
      <div className={styles.clubsTop}>
        <div className="wrap">
          <div className="tag">{clubs.length || totalFromStats} Active Clubs</div>
          <h1 className={`${styles.clubsTitle} fade`}>Find Your<br />Community</h1>
          <p className={`${styles.clubsSub} fade`}>Browse all {clubs.length || totalFromStats} SOAC-recognised clubs across 4 categories.</p>

          <div className={styles.filterRow}>
            <div className={styles.filterBtns}>
              {Object.entries(CAT_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  className={`${styles.fb} ${filter === key ? styles.fbOn : ''}`}
                  onClick={() => setFilter(key)}
                  style={filter === key && key !== 'all' ? { background: CAT_COLORS[key] + '18', color: CAT_COLORS[key], borderColor: CAT_COLORS[key] + '44' } : {}}
                >
                  {label} {key !== 'all' && `(${clubs.filter(c => c.cat === key && matchesSearch(c)).length})`}
                </button>
              ))}
            </div>
            <div className={styles.filterRight}>
              <div className={styles.searchWrap}>
                <svg className={styles.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input
                  className={styles.searchInp}
                  placeholder="Search clubs..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button className={styles.searchClear} onClick={() => setSearch('')}>✕</button>
                )}
              </div>
              <button className={styles.proposeBtn} onClick={() => setShowModal(true)}>
                + Propose a Club
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── INFO BANNER ── */}
      <div className={styles.infoBanner}>
        <div className="wrap">
          <div className={styles.infoInner}>
            <span style={{ fontSize: 20 }}>💡</span>
            <div>
              <strong>Want to join a club?</strong>
              {user
                ? ' You\'re logged in. Head to your portal to manage your club memberships.'
                : ' Click "Join Club →" on any card below to submit a request. Once approved by the coordinator, your login credentials will be sent to your email.'}
            </div>
            <button className={styles.infoBtn} onClick={() => user ? navigate('/student/clubs') : undefined} style={user ? {} : { display:'none' }}>
              My Clubs →
            </button>
          </div>
        </div>
      </div>

      {/* ── CLUBS GRID ── */}
      <div className={styles.clubsMain}>
        <div className="wrap">
          <div className={styles.gridMeta}>
            Showing <strong>{filtered.length}</strong> clubs
            {search && <> for "<em>{search}</em>"</>}
          </div>

          {filtered.length === 0 ? (
            <div className={styles.empty}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
              <h3>No clubs found</h3>
              <p>Try a different search or category filter.</p>
              {search && (
                <button className="btr" style={{ marginTop: 12 }} onClick={() => setSearch('')}>Clear Search</button>
              )}
            </div>
          ) : (
            <div className={styles.grid}>
              {filtered.map((club, i) => (
                <div key={club._id || club.name || i} className={styles.card}>
                  <div className={styles.cardTop} style={{ background: club.color + '18', borderBottom: `2px solid ${club.color}30` }}>
                    <span className={styles.cardCat} style={{ background: (CAT_COLORS[club.cat] || '#635BFF') + '14', color: CAT_COLORS[club.cat] || '#635BFF' }}>
                      {CAT_LABELS[club.cat]?.replace(/^[^ ]+ /, '') || club.cat}
                    </span>
                    <div className={styles.cardLogo}>
                      <img
                        src={club._apiLogo || `/logos/${club.logo}`}
                        alt={club.name}
                        loading="lazy"
                        onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                      />
                      <div className={styles.cardLogoFallback} style={{ background: club.color + '20', color: club.color }}>{club.name[0]}</div>
                    </div>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardName}>{club.name}</div>
                    <div className={styles.cardCoord}>👔 {club.coord} · Est. {club.yr}</div>
                    <div className={styles.cardStats}>
                      <span style={{ color: '#635BFF' }}>👥 {club.members} members</span>
                      <span style={{ color: '#00C896' }}>📅 {club.events} events</span>
                    </div>
                  </div>
                  <div className={styles.cardFoot}>
                    {user ? (
                      <button className={styles.cardBtn} onClick={() => navigate('/student/clubs')}>
                        View My Clubs →
                      </button>
                    ) : (
                      <button className={styles.cardBtn} onClick={() => setJoiningClub(club)}>
                        Join Club →
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── PROPOSE MODAL ── */}
      {showModal && <ProposeModal onClose={() => setShowModal(false)} />}

      {/* ── JOIN MODAL ── */}
      {joiningClub && <JoinModal club={joiningClub} onClose={() => setJoiningClub(null)} />}
    </div>
  );
};

export default Clubs;
