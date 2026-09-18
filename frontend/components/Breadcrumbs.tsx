import Link from 'next/link';
import { Home, ChevronRight } from 'lucide-react';

interface Crumb { label: string; href?: string; }

export default function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <div className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] mb-4">
      <Home className="w-3.5 h-3.5 text-[var(--text-muted)]" />
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          {item.href ? (
            <Link href={item.href} className="hover:text-[#1662dd] hover:underline">{item.label}</Link>
          ) : (
            <span className="text-[var(--text-primary)]">{item.label}</span>
          )}
        </span>
      ))}
    </div>
  );
}
