import { config } from 'dotenv';
import { execFileSync } from 'node:child_process';

/**
 * The end-to-end suite gets its own database, seeded once. It must not share
 * one with the vitest suite, which truncates between files.
 */
export default function globalSetup() {
  const env: Record<string, string> = {};
  config({ path: '.env.e2e', processEnv: env });

  const run = (args: string[]) =>
    execFileSync('npx', args, { env: { ...process.env, ...env }, stdio: 'pipe' });

  run(['prisma', 'migrate', 'deploy']);
  run(['tsx', 'prisma/seed.ts']);
}
