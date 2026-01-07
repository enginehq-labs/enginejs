#!/usr/bin/env node
import { runCli } from '../dist/cli.js';

Promise.resolve(runCli()).catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[enginehq] fatal', e);
  process.exit(1);
});
