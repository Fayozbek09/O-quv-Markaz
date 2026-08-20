import { config } from 'dotenv';
import { Client } from 'pg';

/**
 * Clears the login throttle between browser sign-ins.
 *
 * `auth:login:identifier` allows eight attempts per quarter of an hour, and the
 * suite signs the same seeded owner in far more often than that across its
 * files — so the limiter would start refusing correct credentials part-way
 * through a run, and whichever test came next would fail for a reason that has
 * nothing to do with what it is checking.
 *
 * The limiter is not being weakened or skipped: it is exercised directly in the
 * vitest security and HTTP suites, where the counting is the thing under test.
 * Here it is incidental, so the counter is reset rather than waited out.
 *
 * This talks to Postgres through `pg` rather than through Prisma because
 * Playwright's loader cannot import the generated ES-module client. One
 * statement against a table this suite owns does not need an ORM.
 */
const env: Record<string, string> = {};
config({ path: '.env.e2e', processEnv: env });

const connectionString = env.DATABASE_URL ?? process.env.DATABASE_URL;

export async function clearLoginThrottle(): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    // The counter key is a single hashed string, so a bucket cannot be picked
    // out by name. The end-to-end database belongs to this suite alone, so
    // clearing the table outright is both safe and plain about what it does.
    await client.query('DELETE FROM rate_limit_counters');
  } finally {
    await client.end();
  }
}
