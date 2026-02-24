#!/usr/bin/env bun
/**
 * emberdeck CLI 엔트리포인트.
 *
 * 하위 커맨드:
 *   mcp   — MCP stdio 서버 실행
 *
 * 옵션:
 *   --dir <path>          카드 디렉토리 경로
 *   --db-path <path>      SQLite DB 파일 경로
 *   --project-root <path> gildash 활성화용 프로젝트 루트
 *   --config <path>       설정 파일 경로 (.emberdeck.jsonc / .json)
 *
 * 우선순위: CLI args > config file > defaults
 *
 * @example
 *   bun run cli.ts mcp --dir ./cards --db-path ./data.db
 *   bun run cli.ts mcp --config .emberdeck.jsonc
 *   bun run cli.ts mcp  # 자동으로 .emberdeck.jsonc / .json 탐색
 */

import { parseArgs } from 'node:util';
import { isErr } from '@zipbul/result';
import { loadConfig, loadConfigFromPath, mergeCliArgs, buildDefaultConfig } from './src/config-file';
import type { EmberdeckFileConfig, ConfigError } from './src/config-file';
import type { Result } from '@zipbul/result';

// ── CLI arg 파싱 ──

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
  process.stderr.write(`emberdeck — 구조화된 지식 카드 시스템

Usage:
  emberdeck <command> [options]

Commands:
  mcp    MCP stdio 서버 실행

Options:
  --dir <path>          카드 디렉토리 경로
  --db-path <path>      SQLite DB 파일 경로
  --project-root <path> gildash 프로젝트 루트
  --config <path>       설정 파일 경로
  -h, --help            도움말 출력
  -v, --version         버전 출력

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
  process.stderr.write('\nError: subcommand를 지정해야 합니다 (예: mcp)\n');
  process.exit(1);
}

if (subcommand === 'mcp') {
  await runMcp();
} else {
  process.stderr.write(`Error: 알 수 없는 subcommand "${subcommand}"\n`);
  process.stderr.write('사용 가능한 subcommand: mcp\n');
  process.exit(1);
}

// ── MCP subcommand ──

async function runMcp(): Promise<void> {
  // 1. Config 로드
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
