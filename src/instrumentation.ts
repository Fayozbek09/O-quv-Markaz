/**
 * Runs once, when the server starts.
 *
 * The production preflight lives here rather than at the bottom of `lib/env.ts`
 * so that it happens at boot: a module-level check only fires when something
 * first imports that module, which means a misconfigured server would accept
 * connections and then fail on whichever request happened to touch it. A
 * process that refuses to start is a deployment that gets fixed.
 */
export async function register() {
  // The edge runtime has no server to boot and no secrets to check.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertProductionEnvironment, preflightApplies } = await import('./lib/env');
  if (preflightApplies) assertProductionEnvironment();
}
