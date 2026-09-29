// One-off script (not part of the server) invoked by ../../start_dashboard BEFORE anything is
// started — checks whether the frontend's OIDC login app has a redirect URI registered for
// whatever port the frontend is about to run on, and offers to add it live if not. Run directly:
//   npx tsx scripts/check-redirect-uri.ts <frontend-port>
//
// Needs two separate .env files: backend/.env for the Okta Management API credentials this
// script authenticates with (via ../src/services/okta.ts), and frontend/.env.local for
// OKTA_CLIENT_ID (the OIDC web app's client id — it only exists in the frontend's own env, never
// the backend's). Loaded separately and never merged into one process.env, so the two apps'
// configs can't cross-contaminate each other.
import '../src/env';
import { parse } from 'dotenv';
import { expand } from 'dotenv-expand';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import * as readline from 'readline';
import * as okta from '../src/services/okta';

function loadFrontendEnv(): Record<string, string> {
  const path = resolve(__dirname, '../../frontend/.env.local');
  const parsed = parse(readFileSync(path, 'utf8'));
  const result = expand({ parsed: { ...parsed } });
  return result.parsed || {};
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (answer) => { rl.close(); res(answer); }));
}

async function main() {
  const port = process.argv[2];
  if (!port) {
    console.error('Usage: check-redirect-uri.ts <frontend-port>');
    process.exit(3);
  }

  const frontendEnv = loadFrontendEnv();
  const clientId = frontendEnv.OKTA_CLIENT_ID;
  if (!clientId) {
    console.warn('OKTA_CLIENT_ID is not set in frontend/.env.local — skipping redirect URI check.');
    process.exit(3);
  }

  const expectedUri = `http://localhost:${port}/api/auth/callback/okta`;
  const existing = await okta.getAppRedirectUris(clientId);
  if (existing.includes(expectedUri)) {
    process.exit(0);
  }

  console.log(`Redirect URI ${expectedUri} is not registered on the Okta login app (client_id ${clientId}).`);
  console.log(`Currently registered: ${existing.length > 0 ? existing.join(', ') : '(none)'}`);

  if (!process.stdin.isTTY) {
    console.log(`Add it manually in the Okta Admin Console (Applications > the app for ${clientId} > General > Sign-in redirect URIs), or re-run this interactively.`);
    process.exit(1);
  }

  const answer = await prompt('Add it to the Okta app now? [y/N] ');
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log(`Not added. Add ${expectedUri} manually before logging in, or re-run this check.`);
    process.exit(1);
  }

  try {
    await okta.addAppRedirectUri(clientId, expectedUri);
    console.log(`Added ${expectedUri} to the Okta app.`);
    process.exit(0);
  } catch (e: any) {
    console.warn(`Failed to add the redirect URI: ${e.message}`);
    process.exit(2);
  }
}

main().catch((e) => {
  console.warn(`Redirect URI check failed: ${e.message}`);
  process.exit(3);
});
