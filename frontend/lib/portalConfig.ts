// Request-portal branding — all configurable per-deployment via env vars (see
// frontend/.env.example) rather than hardcoded, since this app is meant to be forked and
// rebranded for different customers. Falls back to a generic "Agent Request" identity if unset.
export const portalConfig = {
  name: process.env.NEXT_PUBLIC_PORTAL_NAME || 'Agent Request',
  tagline: process.env.NEXT_PUBLIC_PORTAL_TAGLINE || 'Developer Experience Platform',
  logoPath: process.env.NEXT_PUBLIC_PORTAL_LOGO_PATH || '',
  logoAlt: process.env.NEXT_PUBLIC_PORTAL_LOGO_ALT || 'Company logo',
  primaryColor: process.env.NEXT_PUBLIC_PORTAL_PRIMARY_COLOR || '',
  accentColor: process.env.NEXT_PUBLIC_PORTAL_ACCENT_COLOR || '',
};
