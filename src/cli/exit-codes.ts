/**
 * CLI exit codes per CLI_PLAN §2.3.
 * Scripts can branch on these to distinguish failure modes.
 */
export const EXIT = {
  OK: 0,
  GENERIC_ERROR: 1,
  VALIDATION_FAILURE: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  PERMISSION_OR_IO: 5,
  CONFIG_MISSING: 6,
  TRANSIENT: 7,
  SIGINT: 130,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
