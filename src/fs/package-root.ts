import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * `from`에서 위로 올라가며 `package.json`을 찾아 패키지 루트를 반환.
 * 찾지 못하면 `from`을 그대로 반환한다.
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
