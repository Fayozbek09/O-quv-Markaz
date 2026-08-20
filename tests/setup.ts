import { config } from 'dotenv';
import { beforeAll } from 'vitest';

// The suite must never touch the development database.
config({ path: '.env.test', override: true });

beforeAll(() => {
  if (!process.env.DATABASE_URL?.includes('ustozly_test')) {
    throw new Error('Refusing to run tests against a non-test database');
  }
});
