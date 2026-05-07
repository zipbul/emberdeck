/** @spec generic/repository */
export abstract class BaseRepository<T extends { id: string }> {
  protected readonly items: Map<string, T> = new Map();

  abstract findByKey(key: string): T | undefined;

  save(item: T): void {
    this.items.set(item.id, item);
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }
}

/** @spec generic/user-repository */
export class UserRepository extends BaseRepository<{ id: string; name: string }> {
  findByKey(key: string): { id: string; name: string } | undefined {
    return this.items.get(key);
  }

  findByName(name: string): { id: string; name: string } | undefined {
    for (const item of this.items.values()) {
      if (item.name === name) return item;
    }
    return undefined;
  }
}
