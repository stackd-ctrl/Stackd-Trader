// Shared auth for cron routes.
// GET: requires `Authorization: Bearer ${CRON_SECRET}` (set by Vercel cron).
// POST: requires `x-manual-trigger: true` (set by the dashboard button).

export function isAuthorizedCron(req: Request): boolean {
  if (req.method === 'POST') {
    return req.headers.get('x-manual-trigger') === 'true';
  }
  // GET path — Vercel sets CRON_SECRET as bearer token.
  const expected = process.env.CRON_SECRET;
  if (!expected) return true; // dev mode: no secret configured
  return req.headers.get('authorization') === `Bearer ${expected}`;
}
