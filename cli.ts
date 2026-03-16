#!/usr/bin/env bun
/**
 * emberdeck CLI entry point.
 *
 * Subcommands:
 *   mcp   — Start MCP stdio server
 *
 * Options:
 *   --dir <path>          Card directory path
 *   --db-path <path>      SQLite DB file path
 *   --project-root <path> Project root for gildash integration
 *   --config <path>       Config file path (.emberdeck.jsonc / .json)
 *
 * Priority: CLI args > config file > defaults
 *
 * @example
 *   bun run cli.ts mcp --dir ./cards --db-path ./data.db
 *   bun run cli.ts mcp --config .emberdeck.jsonc
 *   bun run cli.ts mcp  # Auto-searches for .emberdeck.jsonc / .json
 */

import { parseArgs } from 'node:util';
import { isErr } from '@zipbul/result';
import { loadConfig, loadConfigFromPath, mergeCliArgs, buildDefaultConfig } from './src/config-file';
import type { EmberdeckFileConfig, ConfigError } from './src/config-file';
import type { Result } from '@zipbul/result';

// ── CLI arg parsing ──

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    dir: { type: 'string' },
    'db-path': { type: 'string' },
    'project-root': { type: 'string' },
    config: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  allowPositionals: true,
  strict: true,
});

// ── Help / Version ──

function printHelp(): void {
  process.stderr.write(`emberdeck — Structured knowledge card system

Usage:
  emberdeck <command> [options]

Commands:
  mcp    Start MCP stdio server

Options:
  --dir <path>          Card directory path
  --db-path <path>      SQLite DB file path
  --project-root <path> Gildash project root
  --config <path>       Config file path
  -h, --help            Show help
  -v, --version         Show version

Priority: CLI args > config file > defaults
Config auto-search: .emberdeck.jsonc → .emberdeck.json (CWD)
`);
}

if (values.help) {
  printHelp();
  process.exit(0);
}

if (values.version) {
  process.stderr.write('emberdeck 0.2.0\n');
  process.exit(0);
}

// ── Subcommand dispatch ──

const subcommand = positionals[0];

if (!subcommand) {
  printHelp();
  process.stderr.write('\nError: A subcommand is required (e.g. mcp)\n');
  process.exit(1);
}

if (subcommand === 'mcp') {
  await runMcp();
} else {
  process.stderr.write(`Error: Unknown subcommand "${subcommand}"\n`);
  process.stderr.write('Available subcommands: mcp\n');
  process.exit(1);
}

// ── MCP subcommand ──

async function runMcp(): Promise<void> {
  // 1. Load config
  let result: Result<EmberdeckFileConfig, ConfigError>;

  if (values.config) {
    result = await loadConfigFromPath(values.config);
  } else {
    result = await loadConfig();
  }

  if (isErr(result)) {
    const e = result.data;
    process.stderr.write(`[config error] ${e.code}: ${e.message}\n`);
    if (e.filePath) {
      process.stderr.write(`  file: ${e.filePath}\n`);
    }
    process.exit(1);
  }

  // 2. CLI args override
  const config = mergeCliArgs(result, {
    dir: values.dir,
    dbPath: values['db-path'],
    projectRoot: values['project-root'],
  });

  // 3. Setup emberdeck
  const { setupEmberdeck, registerEmberdeckTools } = await import('./index');

  const ctx = await setupEmberdeck({
    cardsDir: config.cardsDir,
    dbPath: config.dbPath,
    projectRoot: config.projectRoot,
    allowedRelationTypes: config.allowedRelationTypes,
    gildashIgnore: config.gildashIgnore,
  });

  // 4. MCP server
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

  const server = new McpServer({ name: 'emberdeck', version: '0.2.0' });
  registerEmberdeckTools(server, ctx);

  // Graceful shutdown: ensure DB is closed and WAL checkpointed
  const { teardownEmberdeck } = await import('./index');
  const shutdown = async () => {
    await teardownEmberdeck(ctx);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
