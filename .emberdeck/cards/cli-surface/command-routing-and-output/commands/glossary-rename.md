---
key: cli-surface/command-routing-and-output/commands/glossary-rename
summary: >-
  ed glossary rename <old> <new> [--def TEXT] emits {old_word, new_word, affected_card_keys,
  failed_file_writes?} per C3; failed_file_writes is optional (present only when non-empty)
  to keep the success shape lean.
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        oldWord exists in glossary; newWord is unique (otherwise CONFLICT).
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        success stdout JSON shape (C3 single mutation):

        ```
        {
          old_word:             string,
          new_word:             string,
          affected_card_keys:   string[],          // cards updated to reference new_word
          failed_file_writes?:  string[]           // card keys whose file write failed
                                                   //   present only when non-empty
        }
        ```

        `definition` is NOT in the response — it's an input echo and consumers
        already know it (per D32 v2.9).
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        exit code policy: 0 if no failed_file_writes; 2 if some card files
        couldn't be updated (DB rename succeeded but on-disk card files stale).
        thrown→3 (NOT_FOUND) if oldWord doesn't exist; thrown→4 (CONFLICT) if newWord
        already in glossary.
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
        affected_card_keys lists EVERY card whose DB row was updated to reference
        new_word; failed_file_writes is a strict subset (DB succeeded, file write
        didn't). next `ed bulk sync` reconciles on-disk with DB.
      always_holds: per-call
  failures:
    - violation: oldWord not in glossary.
      behavior: thrown → stderr `CARD_NOT_FOUND`; exit 3.
    - violation: newWord already in glossary.
      behavior: thrown → stderr `CARD_ALREADY_EXISTS`; exit 4.
    - violation: A card file write fails after DB rename succeeds.
      behavior: >-
        DB rename stays; key appears in failed_file_writes; exit 2.
        `ed bulk sync` re-renders the affected files from DB.
---
