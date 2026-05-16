---
key: cli-surface/command-routing-and-output/commands/card-get
summary: >-
  Per-command CLI-shape spec for 'ed card get <key>'; declares flat frontmatter
  stdout shape (POST-001) and 0/3 exit policy (POST-002).
status: active
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - json-envelope
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        Runner has built a CliRuntime and forwarded commander-validated
        arguments to this command's action.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        On success the command returns a `{data, exitCode?}` envelope where
        `data` flattens CardFrontmatter fields at the root plus sync metadata:

        ```jsonc

        // stdout shape for `ed card get <key>` — CardFrontmatter flat (no
        frontmatter wrapper) plus sync metadata.

        {
          key, summary, status, type, parent: string | null,
          glossary: string[],
          relations?: string[],
          tags?: string[],
          principle?, domain?, brief?, spec?,   // namespace body for the card's type (matches CardFrontmatter)
          filePath, updatedAt?,                  // sync metadata derived from the indexed card row
          history?: {
            entries: {
              field: string,         // 'summary' | 'type' | 'status' | 'parent' | 'relations' | 'tags' | 'glossary' | namespace body
              oldValue: string | null,
              newValue: string | null,
              changedAt: string,
              changedBy: string
            }[]
          }
        }

        ```
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        - 0 (EXIT.OK): the card exists and its frontmatter (plus optional
        history) is returned.

        - thrown mapping: CardNotFoundError → 3 (EXIT.NOT_FOUND).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-002
  invariants:
    - id: INV-001
      statement: >-
        Inherits INV-001..INV-005 from parent spec runner-and-output (canonical
        stderr JSON-line schema, disjoint stdout/stderr channels, no envelope,
        --quiet semantics, empty stdout on failure).
      always_holds: per-call
  failures:
    - violation: >-
        No card exists for the requested key (also surfaced when the path
        resolves but the frontmatter key disagrees with the filename slug —
        readCardFileOrThrow treats key mismatch as not-found at the
        mutation/read entry).
      behavior: >-
        Runner maps CardNotFoundError through toCliError, emits one
        `{level:'error', code:'card-not-found', message, details?}` JSON-line on
        stderr, and exits 3.
---
