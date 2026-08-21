import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { ensureProductionBuild } from '../support/build';
import { config } from 'dotenv';

/**
 * Boots the production build on a dedicated port so the HTTP suite exercises
 * the real middleware, the real cookie handling and the real headers - not a
 * mock of them.
 */
const PORT = 3111;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | null = null;

async function waitForReady(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/login`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(3000),
      });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('server did not become ready');
}

/**
 * Port 3111 belongs to this suite and nothing else, so a process still holding
 * it is by definition a leftover from an interrupted run. A wedged leftover
 * answers nothing but keeps the port, which used to fail the whole suite with
 * an unhelpful "server did not become ready" — so it is cleared before we try
 * to bind.
 */
function reclaimPort() {
  try {
    execFileSync('fuser', ['-k', `${PORT}/tcp`], { stdio: 'ignore', timeout: 5000 });
  } catch {
    // `fuser` is absent or nothing was listening; both are fine.
  }
}

export async function setup() {
  // Reuse an instance left behind by a previous run rather than fighting it
  // for the port.
  try {
    // Time-bounded: a wedged leftover process still holds the port but never
    // answers, and an unbounded probe would hang the whole suite.
    const probe = await fetch(`${BASE_URL}/login`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    });
    if (probe.status < 500) return;
  } catch {
    /* nothing listening, or it is not answering - start our own */
  }

  reclaimPort();
  // Give the kernel a moment to release the socket before binding it.
  await new Promise((resolve) => setTimeout(resolve, 500));

  const testEnv: Record<string, string> = {};
  config({ path: '.env.test', processEnv: testEnv });

  /*
   * Bring the test database up to the schema before anything reads it. Adding a
   * migration and forgetting this step surfaces as `column … does not exist`
   * halfway through an unrelated suite, which reads like a broken test rather
   * than a stale database — it cost a debugging session more than once.
   */
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, ...testEnv },
    stdio: 'pipe',
  });

  ensureProductionBuild();

  child = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...testEnv,
      // Run the production build with production semantics, but keep the test
      // database and test secrets.
      NODE_ENV: 'production',
      APP_URL: BASE_URL,
    },
    // stdout is ignored on purpose: an undrained pipe fills up and wedges the
    // server mid-request. Only stderr is captured, and only to surface errors.
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  child.stderr?.on('data', (chunk) => {
    const line = String(chunk);
    // Expected 401/403 responses are logged by Next as route errors; only
    // surface something that looks like a genuine startup failure.
    if (line.includes('EADDRINUSE') || line.includes('Invalid environment')) {
      process.stderr.write(`[server] ${line}`);
    }
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) process.stderr.write(`[server] exited with ${code}\n`);
  });

  await waitForReady();
}

export async function teardown() {
  if (!child) {
    reclaimPort();
    return;
  }
  // Detach the pipes first: an open stdio stream keeps the event loop alive and
  // vitest then waits for a process that has already been asked to stop.
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  child.kill('SIGKILL');
  child.unref();
  child = null;
  // `next start` spawns a worker; killing the parent does not always take the
  // listener with it, and a survivor would break the next run.
  reclaimPort();
}
