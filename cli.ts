#!/usr/bin/env bun
/**
 * emberdeck `ed` CLI entry point.
 *
 * All commands are dispatched via Commander in src/cli/index.ts.
 * Run `ed --help` or `ed <noun> --help` for usage.
 */

import { main } from './src/cli/index';

await main();
