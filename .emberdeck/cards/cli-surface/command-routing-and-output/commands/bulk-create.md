---
key: cli-surface/command-routing-and-output/commands/bulk-create
summary: >-
  ed bulk create emits {created:[{input_index,key,filePath}],
  failed:[{input_index,key?,error}], total, partial_keys?} per C4
  batch-mutation; array-valued so the caller can identify which input failed and
  retry; input_index preserved through topological reorder.
status: draft
type: spec
parent: cli-surface/command-routing-and-output
glossary:
  - card-key
spec:
  preconditions:
    - id: PRE-001
      condition: >-
        --from FILE resolves to a JSON array of {key, type, summary, ...}
        objects; STDIN ("-") is permitted.
      derives: cli-surface/command-routing-and-output#G-001
  postconditions:
    - id: POST-001
      guarantee: >-
        success stdout JSON shape (C4 batch-mutation):

        ```
        {
          created: { input_index: number, key: string, filePath: string }[],
          failed:  { input_index: number, key?: string, error: string }[],
          total:   number,                  // length of the input array as parsed
          partial_keys?: string[]           // present only if non-empty;
                                            //   keys whose Phase 2 relation update
                                            //   failed (card exists, relations missing)
        }
        ```

        `created`/`failed` are arrays (not counters) so a caller can identify
        which input failed and retry it; `input_index` is the 0-based position
        in the input array as parsed.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-001
    - id: POST-002
      guarantee: >-
        exit code policy: 0 if failed.length === 0; 2 (VALIDATION_FAILURE) if
        any entry is in failed. The runner emits the data shape regardless;
        callers MUST consult exit code for the gate signal.
      keyword: SHALL
      derives: cli-surface/command-routing-and-output#G-002
    - id: POST-003
      guarantee: >-
        --quiet does not alter the shape (D19); stdout remains the same
        compact JSON value. Non-fatal warnings on stderr are suppressed; the
        error JSON-line on a thrown exception is always emitted.
      keyword: MUST
      derives: cli-surface/command-routing-and-output#G-005
  invariants:
    - id: INV-001
      statement: >-
        input_index is preserved through bulkCreateCards' internal topological
        reorder. The op augments inputs with a private __inputIndex field at
        entry; the field travels with each item and is the canonical source
        for both created[].input_index and failed[].input_index. Duplicate
        input keys produce two failed entries with distinct input_index.
      always_holds: per-call
    - id: INV-002
      statement: >-
        created.length + failed.length === total. Every input contributes
        exactly one entry to one of the two arrays.
      always_holds: per-call
  failures:
    - violation: >-
        Input item lacks `key`, `type`, or `summary`, or `type` is not in
        CARD_TYPES.
      behavior: >-
        Entry appears in failed[] with code BULK_VALIDATION_FAILED and the
        item's input_index; the op never sees that item. Other items still
        process. Exit 2 if any failed entries exist.
    - violation: A card key already exists on disk or in DB (CardAlreadyExistsError).
      behavior: >-
        Per-input entry in failed[] with the thrown error message;
        created[] excludes that key. Exit 2.
    - violation: >-
        Phase 2 relation update fails for a successfully-Phase-1-created card
        (e.g. target card missing).
      behavior: >-
        Card stays in DB (Phase 1 succeeded) but key moves from created[]
        to partial_keys[]; one entry appears in failed[] with a message
        prefixed "relation update failed: …". Exit 2.
---
