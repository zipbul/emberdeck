import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Traverses upward from `from` to find `package.json` and returns the package root.
 * Returns `from` as-is if not found.
  * @spec cli-surface/project-setup/setup-config-root
 */
export function findPackageRoot(from: string): string {
  let dir = resolve(from);
  while (true) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return from;
    dir = parent;
  }
}
