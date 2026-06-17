import React from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Steps.module.css';

const Steps = () => {
  const navigate = useNavigate();
  const steps = [
    { num: 1, title: 'Send Join Request', desc: 'Create your account with your RKU student email in under 2 minutes.' },
    { num: 2, title: 'Get Login Credentials', desc: 'You will receive your credentials as soon as coordinator accepts your request.' },
    { num: 3, title: 'Login', desc: 'Explore club Schedule, Events, Leadership and more.' },
    { num: 4, title: 'Browse More Clubs', desc: 'In your dashboard, explore more clubs of your interest.You can join Maximum 3 clubs for best experience.' },
  ];

  return (
    <section className={styles.steps}>
      <div className="wrap">
        <div className={styles.header}>
          <div className="tag" style={{ justifyContent: 'center' }}>Simple Process</div>
          <h2 className="h2" style={{ textAlign: 'center', marginBottom: '9px' }}>
            How to Join a Club
          </h2>
        </div>

        <div className={styles.sgrid}>
          {steps.map((step, i) => (
            <div key={i} className={`${styles.sc} fade delay-${i + 1}`}>
              <div className={styles.scn}>{step.num}</div>
              <h3>{step.title}</h3>
              <p>{step.desc}</p>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: '38px' }}>
          <button className="btr" onClick={() => navigate('/login')}>
            Create Your Account &rarr;
          </button>
        </div>
      </div>
    </section>
  );
};

export default Steps;
