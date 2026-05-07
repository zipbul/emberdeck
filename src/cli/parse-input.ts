import { errorMessage } from '../util/error';
import { CliUsageError } from './usage-error';

/**
 * Parse text as JSON first, fall back to YAML. Used by `card create`/`card update`
 * `--from`/`--patch` and `bulk create --from` for accepting either format.
 */
export function parseJsonOrYaml(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(text);
    } catch {
      // fall through to YAML
    }
  }
  try {
    return Bun.YAML.parse(text);
  } catch (e) {
    throw new CliUsageError(`failed to parse input as JSON or YAML: ${errorMessage(e)}`);
  }
}
