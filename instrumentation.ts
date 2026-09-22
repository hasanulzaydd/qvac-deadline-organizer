/**
 * Runs once when the Next.js server starts. It begins loading the QVAC models
 * straight away, so on a fresh machine the ~2.6 GB first-run download starts
 * with `npm run dev` instead of inside the user's first Extract click.
 *
 * It does not wait for the load: `register` must finish before the server
 * accepts requests, and the page shows progress while the models arrive.
 */
export async function register() {
  // QVAC is Node-only; never load models during `next build`.
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;

  const { getQvac } = await import('./lib/qvac');
  // Errors are recorded and shown by /api/health; a later request retries.
  void getQvac().catch(() => {});
}
