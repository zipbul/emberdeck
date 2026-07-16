---
name: emberdeck-vision-card
description: >-
  Create, read, update, and delete a project's vision card in emberdeck, and write
  vision content worth deriving from. Use whenever the user works with the project's
  vision: "write/set up our vision", "the vision is just a feature list / too generic
  / only KPIs", "fix the vision", "what's our vision", "delete the vision card", or
  any `ed card ... --type vision` / `.emberdeck/cards` vision work. vision is the
  single root of the 5-tier deck, so use this even when the user only says "vision".
---

# emberdeck vision card

vision is the single root of the 5-tier deck (**vision · principle · domain · brief ·
spec**) — it states, as *direction*, where the project is going, and everything below
traces up to it.

## The card

A `.md` under `.emberdeck/cards/`; the frontmatter's `vision:` namespace holds three
required prose fields. **Numbers go in `principle.metric`, not here.**

| field | holds | test |
|---|---|---|
| `statement` | the **direction** the project moves in (a from→to vector), not a feature list | "a compass, or a backlog?" |
| `rationale` | the problem that makes that direction necessary; a ground that stands on its own | "justifies the direction, or restates it?" |
| `success_direction` | a **qualitative** picture of heading the right way, not a number | "observable without a dashboard?" |

Work each field until it passes its test; keep it specific enough that it could only
describe *this* project (not an "empower everyone to…" mad-lib), in the deck's language.

### Rules

- **Singleton** — at most one vision per project; a second trips `vision-singleton` at
  validate. "A vision for feature X" wants a *brief* or *domain*, not a second vision.
- **Root-only** — no parent; `--parent` is a usage error.
- **Status** `draft` → `active`; activating requires all three fields non-empty
  (activation guard). There is no `drifted` (vision isn't bound to code).
- **`--patch` replaces the whole `vision` namespace** — not a field merge. To change one
  field, send all three (read-modify-write); omit one and the patch is rejected.

## CLI

Invoke as `ed` if emberdeck's `ed` is on `PATH` — check with `ed --version` (bare semver
like `0.3.0`; the Unix line editor is also named `ed` and prints `GNU Ed`). Inside the
emberdeck source repo use `bun cli.ts` from the repo root; in a dependent project
`bunx ed`. Examples use `ed` and pass JSON on STDIN (`--from -` / `--patch -`) to avoid
temp files. After any on-disk change, run `ed validate cards` (see **Verify**).

### Create

`ed card schema vision` shows the shape. Default status is `draft`; use `--status active`
once the content is solid.

```bash
echo '{ "vision": {
  "statement": "…direction, from X to Y…",
  "rationale": "…the problem that makes that direction necessary…",
  "success_direction": "…the qualitative signal we are heading right…"
} }' | ed card create vision --type vision --summary "the direction in one line" --from -
```

The `key` (`vision` here) is the filename and how you address the card later.

### Read

```bash
ed card get <key>                         # full card JSON incl. the vision namespace
ed card list --type vision                # find it when you don't know the key
ed card search "keyword" --type vision    # full-text search
ed card context <key>                     # the vision + what traces to it
```

### Update

Because `--patch` replaces the whole namespace (see Rules), update is read-modify-write:
`ed card get` → edit one field → send all three back.

```bash
echo '{ "vision": { "statement": "…edited…", "rationale": "…unchanged…", "success_direction": "…unchanged…" } }' \
  | ed card update <key> --patch -

ed card update <key> --summary "…"            # summary only
ed card set-status <key> active --reason "…"  # also re-runs the activation guard
```

### Delete

```bash
ed card delete <key> --yes
```

Leaves the deck rootless — do it only to replace the vision or tear the deck down. For a
rewrite, prefer updating in place (preserves changelog history).

## Verify

After every create/update/delete, run `ed validate cards`. `summary.total` must be `0`.
A `vision-singleton` in `byCode` means two vision cards exist — find them with
`ed card list --type vision`, remove the extra, and re-run until `total` is `0`. Don't
report the task done without a clean validate.
