/**
 * The standard surface. `action` sits opposite the title in the header row —
 * that is where the "+ New" style buttons go.
 */
export default function Card({ title, subtitle, action, children, className = '' }) {
  const hasHead = title || subtitle || action;

  return (
    <section className={`card ${className}`.trim()}>
      {hasHead && (
        <div className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
