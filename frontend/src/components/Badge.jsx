/** Pill status chip. `tone` is one of grant | deny | warn | dim. */
export default function Badge({ tone = 'dim', children, className = '' }) {
  return <span className={`badge ${tone} ${className}`.trim()}>{children}</span>;
}

/** GRANT/DENY appears in four different tables — map it in one place. */
export function DecisionBadge({ decision }) {
  if (!decision) return <span className="muted">—</span>;
  return <Badge tone={decision === 'GRANT' ? 'grant' : 'deny'}>{decision}</Badge>;
}
