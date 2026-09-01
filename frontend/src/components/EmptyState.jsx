import { Inbox } from 'lucide-react';

/** Shown in place of an empty list, so a page never renders as a blank card. */
export default function EmptyState({ icon, title, children, action }) {
  const Icon = icon ?? Inbox;

  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={22} />
      </div>
      {title && <strong>{title}</strong>}
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
