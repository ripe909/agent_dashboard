import Link from 'next/link';
import { Bot, ArrowRight } from 'lucide-react';

export default function AgentRequestHomePage() {
  return (
    <div className="text-center py-12">
      <div className="w-14 h-14 rounded-2xl bg-[var(--portal-primary)]/10 flex items-center justify-center mx-auto mb-5">
        <Bot className="w-7 h-7 text-[var(--portal-primary)]" />
      </div>
      <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Request an AI Agent</h1>
      <p className="text-[var(--text-secondary)] text-sm max-w-md mx-auto mb-8">
        Onboard a new agent identity, secured by Okta, in a few steps — no manual
        authentication code or static service accounts required.
      </p>
      <Link
        href="/request/new"
        className="inline-flex items-center gap-2 px-5 py-3 bg-[var(--portal-primary)] hover:opacity-90 text-white text-sm font-semibold rounded-lg transition-opacity"
      >
        Request a new agent <ArrowRight className="w-4 h-4" />
      </Link>
    </div>
  );
}
