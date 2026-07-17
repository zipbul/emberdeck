---
name: emberdeck-principle-card
description: >-
  Create, read, update, and delete principle cards in emberdeck, and write principles
  that actually enforce instead of being hollow. Use whenever the user works with a
  project's principles/norms/invariants in emberdeck: "add a principle", "this
  principle is hollow / enforces nothing", "why does validate reject my principle",
  "make this a blocking rule", "what applies_to/enforcement/verify should this have",
  "list/review which principles the deck has and what each one enforces", choosing the
  verify class (structural/binding/metric/prose), or any
  `ed card ... --type principle` / `.emberdeck/cards` principle work. Do NOT use for
  the other tiers (vision/domain/brief/spec) or for generic coding principles, SOLID,
  or company values that aren't emberdeck principle cards.
---

# emberdeck principle card

A principle is a project-wide norm the whole deck must hold to — a rule declared in a
card so it can actually be enforced, not left in someone's head. Principles are
root-level cards (siblings of vision, above domain/brief/spec). Unlike vision there can
be **many** of them.

The hard part isn't the CRUD — it's writing a principle that *enforces*. A principle
that declares a rule but no real way to check it is **hollow**: it looks like
governance and enforces nothing. Every principle must state **how** it is verified, and
that declaration has to match how the rule is genuinely checked.

## The card

A `.md` under `.emberdeck/cards/`; the frontmatter's `principle:` namespace holds:

| field | holds |
|---|---|
| `statement` | the rule itself — a normative sentence with a keyword (MUST / SHALL / SHOULD / MAY), specific enough to be checkable |
| `rationale` | why the rule exists |
| `applies_to` | scope: `"*"` (every card) or a list of card keys / boundary globs (e.g. `["payment/**"]`) |
| `enforcement` | `blocking` (gates `validate`) · `warning` (in findings, non-gating) · `advisory` (not emitted by `validate` at all) |
| `verify` | **required** — how the rule is checked: `{ class, structural? }`. See **Choosing verify.class** |
| `metric` / `exemptions` / `references` | optional arrays — a `metric` item is `{ name, threshold, unit, comparator (< <= = >= >), kind?, window_kind?, distributable? }` |

### Rules you cannot break

- **verify is required.** A principle with no `verify` is a hollow principle — but
  nothing hard-stops it: `card create` succeeds even with `--status active` (the
  activation guard checks only the namespace and `applies_to`), and the defect surfaces
  only as a `card-sync-failed` warning on **stderr** (hidden by `-q`) while `validate`'s
  JSON stays `total 0`, exit 0. Treat that warning as a real failure anyway.
- **Enforcement must match the class (integrity).** Only classes with an evaluation
  engine may be `blocking`: **structural** and **binding** can block; **prose** and
  **metric** cannot (they must be `warning` or `advisory`). `prose` is human-reviewed;
  `metric` has no measurement feed yet.
- **Root-only, no children.** A principle has no parent (`--parent` is rejected —
  `parent-validation-error`) and no child cards.
- **Status** `draft` → `active`. `drifted` is meant for code-bound cards (brief/spec);
  the CLI will accept it on a principle, but don't set it.
- **`--patch` replaces the whole `principle` namespace** — not a field merge. To change
  one field, send every field back including `verify` (read-modify-write). Beware:
  unlike vision/domain, a principle patch that **omits `verify` is silently accepted**
  — and writes a card the CLI can no longer read (`get`/`update`/`set-status` all fail).
  Recover with `card delete --yes` + recreate, or hand-edit the `.md`.

## Choosing verify.class (this is the point)

Pick the class that matches how the rule is *really* checked. Defaulting everything to
`prose` is the hollow trap — if a rule is a boundary the engine could enforce, declaring
it `prose` throws that enforcement away.

| the rule is… | `verify.class` | can it `block`? | how it's checked |
|---|---|---|---|
| a boundary — in-scope cards must not depend on some target | `structural` | yes | the engine evaluates a graph predicate over `applies_to` at `validate` |
| "the specs this governs must be bound to code" | `binding` | yes | governed non-draft spec cards must carry `@spec` code-link evidence (the cache `ed spec sync` populates — validate has no empty-index leniency) |
| a numeric budget / threshold | `metric` (+ `metric[]`) | no → warning/advisory | no measurement feed yet; a human/CI reads it |
| only human judgment can tell | `prose` | no → warning/advisory | human review |

`structural` is the only class that needs a predicate. The one predicate available is
**`forbids-relation-to`**: no card in `applies_to` may point a forward edge (its
`relations`, cross-domain dependencies, or a spec's `invokes`) at a key matching
`targetGlob`. Use it for boundary rules like "domain A must not couple to domain B".

Three engine facts to get right:
- **Only active principles enforce.** The engines collect rules from `active` principles
  only — a `draft` (or `drifted`) principle enforces nothing. Activate it before
  expecting violations.
- **Glob semantics**: `foo/**` matches keys *under* `foo` but not `foo` itself. To cover
  a domain card and its subtree, write `["foo", "foo/**"]` in `applies_to`, or
  `{foo,foo/**}` (brace form) in `targetGlob`.
- **Only non-draft cards are evaluated**: in-scope `active` and `drifted` cards are
  checked; `draft` ones are skipped — while everything in scope is still `draft`, even a
  `blocking` principle is dormant.

## Running the CLI

Invoke as `ed` if emberdeck's `ed` is on `PATH` — check with `ed --version` (bare semver
like `0.3.0`; the Unix line editor is also named `ed` and prints `GNU ed`). Inside the
emberdeck source repo use `bun cli.ts` from the repo root; in a dependent project
`bunx ed`. Examples use `ed` and pass JSON on STDIN (`--from -` / `--patch -`).

**`card create` does not deeply validate the principle body — the parser does, on the
next read.** Integrity errors (missing `verify`, `prose`/`metric` marked `blocking`, a
`structural` class with no predicate) surface as **stderr** `card-sync-failed` warnings
when any later command syncs the file — they never enter `validate`'s JSON, `total`, or
exit code, and `-q` hides them. So after create/update, run `ed validate cards`, watch
stderr, and treat a `card-sync-failed` on a principle as a real failure to fix.

## Create

`ed card schema principle` shows the shape. Default status is `draft`; use
`--status active` once it validates clean.

```bash
echo '{ "principle": {
  "statement": "Payment code MUST NOT depend on the notification domain.",
  "rationale": "Coupling payment to notification exposes payment integrity to notification outages.",
  "applies_to": ["payment", "payment/**"],
  "enforcement": "blocking",
  "verify": { "class": "structural",
              "structural": { "kind": "forbids-relation-to", "targetGlob": "{notification,notification/**}" } }
} }' | ed card create no-payment-notif-coupling --type principle \
        --summary "payment must not couple to notification" --from -

ed validate cards   # prove it: no card-sync-failed, total 0
```

For a non-structural rule, drop `structural` and match enforcement to the class — e.g. a
back-compat rule only humans can judge is `"verify": { "class": "prose" }` with
`"enforcement": "warning"` (prose can't block).

## Read

```bash
ed card get <key>                        # full card JSON incl. the principle namespace
ed card list --type principle            # all principles in the deck
ed card search "keyword" --type principle
ed card context <key>                    # related cards (no reverse "governs" list —
                                         # governed cards show this principle in their own context's governedBy)
```

## Update

Because `--patch` replaces the whole namespace, update is read-modify-write:
`ed card get` → edit the field(s) → send every field back (including `verify`).

```bash
echo '{ "principle": { "statement": "…", "rationale": "…", "applies_to": "*",
  "enforcement": "warning", "verify": { "class": "prose" } } }' \
  | ed card update <key> --patch -

ed card update <key> --summary "…"            # summary only
ed card set-status <key> active --reason "…"  # activates
```

To lift a hollow `prose` principle into a real one, change `verify.class` to the class
that matches how it's actually checked (often `structural` for boundary rules) and, if it
now has an engine, raise `enforcement` to `blocking`.

## Delete

```bash
ed card delete <key> --yes
```

## Verify

After every create/update/delete, run `ed validate cards`. A healthy principle produces
**no `card-sync-failed` warning** and `summary.total` is `0`. If you see messages like
`verify is required`, `prose cannot be enforcement:blocking`, or `structural requires a
predicate`, the principle is malformed — fix `verify`/`enforcement` and re-run until
clean. Don't report the task done without a clean validate.
