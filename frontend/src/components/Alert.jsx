import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

const ICONS = {
  error: AlertCircle,
  success: CheckCircle2,
  info: Info,
};

export default function Alert({ tone = 'info', children }) {
  const Icon = ICONS[tone] ?? Info;

  return (
    <div className={`alert ${tone}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon size={17} style={{ marginTop: '0.1rem' }} />
      <div>{children}</div>
    </div>
  );
}
