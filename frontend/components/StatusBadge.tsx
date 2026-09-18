import clsx from 'clsx';

const colours: Record<string, string> = {
  active:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending:  'bg-amber-50 text-amber-700 border-amber-200',
  inactive: 'bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] border-[var(--border-default)]',
  error:    'bg-red-50 text-red-700 border-red-200',
  ACTIVE:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] border-[var(--border-default)]',
  STAGED:   'bg-[var(--bg-surface-muted)] text-[var(--text-secondary)] border-[var(--border-default)]',
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border uppercase', colours[status] || colours.pending)}>
      {status}
    </span>
  );
}
