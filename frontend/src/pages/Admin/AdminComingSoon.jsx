import s from './AdminComingSoon.module.css';

export default function AdminComingSoon({ icon, title, description, features = [] }) {
  return (
    <div className={s.page}>
      <div className={s.card}>
        <div className={s.iconWrap}>{icon}</div>
        <div className={s.pill}>Coming Soon</div>
        <h1 className={s.title}>{title}</h1>
        <p className={s.desc}>{description}</p>
        {features.length > 0 && (
          <div className={s.features}>
            {features.map((f, i) => (
              <div key={i} className={s.feature}>
                <span className={s.featureIcon}>{f.icon}</span>
                <div>
                  <div className={s.featureName}>{f.name}</div>
                  <div className={s.featureSub}>{f.sub}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className={s.badge}>🚧 Under Development</div>
      </div>
    </div>
  );
}
