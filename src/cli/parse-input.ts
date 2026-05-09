import { errorMessage } from '../util/error';
import { CliUsageError } from './usage-error';

/**
 * Parse text as JSON. Used by `card create`/`card update` `--from`/`--patch`
 * and `bulk create --from` for accepting input from file or STDIN.
 */
export function parseJsonInput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new CliUsageError(`failed to parse input as JSON: ${errorMessage(e)}`);
  }
}
