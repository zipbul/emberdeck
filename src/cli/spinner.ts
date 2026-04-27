/**
 * Lightweight spinner for long-running operations.
 *
 * - Writes to STDERR (never STDOUT — preserves machine-parseable output)
 * - Auto-disables when stderr is not a TTY OR --quiet/--json mode
 * - Cleared on stop()
 */

import type { OutputContext } from './output';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 80;

export interface Spinner {
  update(label: string): void;
  stop(finalLabel?: string): void;
}

const NOOP_SPINNER: Spinner = {
  update: () => {},
  stop: () => {},
};

/**
 * Start a spinner. Returns a NOOP spinner if:
 *   - output mode is not human (json/quiet)
 *   - stderr is not a TTY
 *   - --verbose is on (verbose stderr lines would interleave with spinner \r writes)
 */
export function startSpinner(ctx: OutputContext, initialLabel: string, opts: { verbose?: boolean } = {}): Spinner {
  if (ctx.mode !== 'human') return NOOP_SPINNER;
  if (!process.stderr.isTTY) return NOOP_SPINNER;
  if (opts.verbose) return NOOP_SPINNER;

  let label = initialLabel;
  let frame = 0;
  let stopped = false;

  const draw = (): void => {
    if (stopped) return;
    process.stderr.write(`\r${FRAMES[frame]} ${label}\x1b[K`);
    frame = (frame + 1) % FRAMES.length;
  };

  draw();
  const interval = setInterval(draw, FRAME_INTERVAL_MS);
  // Don't keep the event loop alive if the command throws and stop() never runs.
  interval.unref?.();

  return {
    update(newLabel: string) {
      // Strip newlines — \r repaint can't undo line wraps and the cursor
      // would scroll past the spinner, leaving garbled output.
      label = newLabel.replace(/[\r\n]/g, ' ');
    },
    stop(finalLabel?: string) {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      // clear current line
      process.stderr.write('\r\x1b[K');
      if (finalLabel) process.stderr.write(`${finalLabel}\n`);
    },
  };
}
