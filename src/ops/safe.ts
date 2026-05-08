import { CompensationError } from '../card/errors';

export interface SafeWriteOptions<T> {
  /** DB transaction action. Executed synchronously. */
  dbAction: () => T;
  /** Filesystem action. Executed asynchronously. */
  fileAction: () => Promise<void>;
  /** Compensation (rollback) action when fileAction fails after dbAction succeeds. */
  compensate: (dbResult: T) => void | Promise<void>;
}

/**
 * Executes DB action first, then file action.
 * On file failure, attempts DB rollback via compensate.
 * If compensate also fails, throws CompensationError.
 *
 * No locking / retry: emberdeck assumes single-process invocation. SQLite WAL
 * handles its own write serialization within a process; cross-process safety
 * is not a feature.
  * @spec card-lifecycle/status-and-safe-write/safe-write
 */
export async function safeWriteOperation<T>(
  options: SafeWriteOptions<T>,
): Promise<T> {
  const { dbAction, fileAction, compensate } = options;

  const result = dbAction();

  try {
    await fileAction();
  } catch (err) {
    try {
      await compensate(result);
    } catch (compErr) {
      throw new CompensationError(err, compErr);
    }
    throw err;
  }

  return result;
}
