---
key: cli-surface/command-routing-and-output/commands/bulk-sync
summary: >-
  ed bulk sync [PATH] emits {synced, mode:'file'|'directory', path, failed:[{filePath,error}]}
  per C4; file-mode and directory-mode share one shape so consumers don't branch on mode for
  failure reporting.
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        PATH (optional) is either an existing file or directory under the cardsDir tree.
        Absent PATH means the configured cardsDir.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        success stdout JSON shape (C4 batch-mutation):

        ```
        {
          synced: number,
          mode:   'file' | 'directory',
          path:   string,                       // resolved path used
          failed: { filePath: string, error: string }[]
        }
        ```

        Both modes carry `failed:[]`; consumers do not branch on `mode` to find failures.
        File-mode `synced` is 1 on success, 0 if its single file failed.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        exit code policy: 0 if failed.length === 0; 2 (VALIDATION_FAILURE) if
        any file failed to parse / upsert.
      keyword: SHALL
      derives: cli-surface/command-routing-and-output#G-002
    - id: POST-003
      guarantee: >-
        --quiet does not change the shape (D19).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-005
  invariants:
    - id: INV-001
      statement: >-
        mode='file' iff PATH was an existing regular file. mode='directory' otherwise.
        The mode field is a discriminator only — failure reporting is uniform.
      always_holds: per-call
  failures:
    - violation: PATH does not exist on disk.
      behavior: >-
        CliUsageError → stderr error JSON-line `CLI_USAGE_ERROR`; exit 2.
        stdout empty (no data emitted on the failure path).
    - violation: An individual card file fails to parse or upsert.
      behavior: >-
        Entry appears in failed[] with {filePath, error}. Other files continue.
        Exit 2 if any failed.
---
