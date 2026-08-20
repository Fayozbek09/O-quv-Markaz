import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
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
      const res = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('server did not become ready');
}

export async function setup() {
  // Reuse an instance left behind by a previous run rather than fighting it
  // for the port.
  try {
    const probe = await fetch(`${BASE_URL}/login`, { redirect: 'manual' });
    if (probe.status < 500) return;
  } catch {
    /* nothing listening - start one */
  }

  const testEnv: Record<string, string> = {};
  config({ path: '.env.test', processEnv: testEnv });

  // `next start` needs a production build. Running the dev server wipes it, so
  // build on demand rather than failing with an opaque startup error.
  if (!existsSync('.next/BUILD_ID')) {
    const build = spawnSync('npx', ['next', 'build'], { stdio: 'inherit' });
    if (build.status !== 0) throw new Error('next build failed; cannot start the HTTP test server');
  }

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
  if (!child) return;
  // Detach the pipes first: an open stdio stream keeps the event loop alive and
  // vitest then waits for a process that has already been asked to stop.
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  child.kill('SIGKILL');
  child.unref();
  child = null;
}
