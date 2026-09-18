'use client';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-page)]">
      <div className="w-full max-w-md px-8 py-10 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-2xl shadow-sm text-center">
        <div className="mb-6">
          <span className="text-4xl font-black tracking-wider text-[#1662dd]">OKTA</span>
          <div className="mt-1 text-xs font-semibold tracking-widest text-[var(--text-muted)] uppercase">Identity Platform</div>
        </div>
        <div className="mb-2 text-2xl font-bold text-[var(--text-primary)]">AI Agent Console</div>
        <p className="text-[var(--text-secondary)] text-sm mb-8">Sign in with your Okta account to manage AI agents</p>
        <button
          onClick={() => signIn('okta', { callbackUrl: '/' })}
          className="w-full py-3 px-6 bg-[#1662dd] hover:bg-blue-600 text-white font-semibold rounded-lg transition-colors text-sm"
        >
          Sign in with Okta
        </button>
        <p className="mt-6 text-xs text-[var(--text-muted)]">Powered by Okta for AI Agents (O4AA)</p>
      </div>
    </div>
  );
}
