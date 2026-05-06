/**
 * Spinner shim. emberdeck is agent-first (JSON-only output), so spinner
 * frames would corrupt machine-parseable stdout/stderr and be invisible
 * to the JSON consumer. The shim preserves call sites with no behavior.
 */

import type { OutputContext } from './output';

export interface Spinner {
  update(label: string): void;
  stop(finalLabel?: string): void;
}

const NOOP_SPINNER: Spinner = {
  update: () => {},
  stop: () => {},
};

export function startSpinner(_ctx: OutputContext, _initialLabel: string, _opts: { verbose?: boolean } = {}): Spinner {
  return NOOP_SPINNER;
}
