import { ensureProductionBuild } from '../tests/support/build';

/**
 * Run by Playwright's webServer command before `next start`. The build has to
 * happen here rather than in globalSetup, because Playwright starts the web
 * server first - and `next dev` leaves a development build in .next that
 * `next start` cannot serve.
 */
ensureProductionBuild();
