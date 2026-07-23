---
name: emberdeck-domain-card
description: >-
  Create, read, update, and delete domain cards in emberdeck, and carve domains that
  draw real boundaries. Use whenever the user works with an emberdeck project's
  domains/bounded contexts: "add a payment domain", "split the project into domains",
  "fill in overview/scope", "this domain depends on that one"
  (cross_domain_dependencies), "why does validate flag relationship-free-text /
  empty-tree", activating a domain, or any `ed card ... --type domain` /
  `.emberdeck/cards` domain work. Do NOT use for the other tiers
  (vision/principle/brief/spec), DNS/web domains, or general domain-driven-design
  advice unrelated to emberdeck cards.
---

# emberdeck domain card

A domain is one part of the world the project deals with — a meaning-unit with its own
terms and rules. Domains are root-level cards (siblings of vision/principle); their
children are **brief** cards, so every plan lives inside exactly one domain. There can
be many domains; together they partition what the project touches.

## The card

A `.md` under `.emberdeck/cards/`; the frontmatter's `domain:` namespace holds:

| field | holds |
|---|---|
| `overview` | prose: what this area is and why it exists |
| `scope` | prose: the IN/OUT boundary — what belongs here and what explicitly does not |
| `cross_domain_dependencies` | optional `[{ domain, relationship, note? }]` — this domain's forward edges to sibling domains |

Cross-dependency shape:
- `domain` — an **existing domain card's key** (checked at activation; self-reference rejected)
- `relationship` — the enum **`invokes` or `consumes`**, nothing else; free text like
  "구독한다" belongs in `note` (validate flags `relationship-free-text` otherwise)
- direction matters: the edge lives on the **depender** (the domain doing the calling/consuming)

### Rules you cannot break

- **Root-only, brief children.** A domain has no parent (`--parent` is rejected —
  `parent-validation-error`); its children must be `brief` cards.
- **Active domains need children.** A non-draft domain with no child cards is flagged
  `empty-tree` by `ed validate cards` (findings gate: exit ≠ 0). Only draft domains are
  exempt — so keep a domain `draft` until its first brief lands, or add the brief in
  the same change.
- **Deps must resolve — at every status.** A dep whose target doesn't exist **or isn't
  a domain card** is flagged `broken-cross-domain-dep` by `validate` (gating), draft or
  not — create the target domain first, always. Activation re-checks the same target
  rules and additionally requires non-empty `overview`/`scope`. Note create/update
  accept a free-text `relationship`; only `validate` flags the enum.
- **Status** `draft` → `active`. `drifted` is meant for code-bound cards (brief/spec);
  the CLI will accept it on a domain, but don't set it.
- **`--patch` replaces the whole `domain` namespace** — not a field merge. To change one
  field, send `overview`, `scope`, and (if present) `cross_domain_dependencies` back
  together (read-modify-write); omitting a required field rejects the patch.

## Carving a good domain

The CLI checks shape, not judgment. What makes a domain worth having:

- **`scope` must draw a boundary, not describe a feature.** Write both sides: what is
  IN and what is explicitly OUT (name the neighboring domain that owns the OUT part).
  If you can't name anything OUT, it isn't a boundary yet.
- **A domain is not a feature.** "결제" (its own terms: 승인, 정산, 환불) is a domain;
  "다크모드" is a brief inside some domain. If it has no vocabulary of its own, it's
  probably a brief.
- **Dependencies are confessions, not wiring.** Each cross-dep records that this
  domain's meaning leans on another's. Many deps in both directions between two domains
  usually means the boundary is drawn wrong — consider merging or re-cutting.

## Running the CLI

Invoke as `ed` if emberdeck's `ed` is on `PATH` — check with `ed --version` (bare semver
like `0.3.0`; the Unix line editor is also named `ed` and prints `GNU ed`). Inside the
emberdeck source repo use `bun cli.ts` from the repo root; in a dependent project
`bunx ed`. Examples use `ed` and pass JSON on STDIN (`--from -` / `--patch -`).

## Create

`ed card schema domain` shows the shape. Default status is `draft` — the right default
here, since an active domain without a brief child trips `empty-tree`.

```bash
# dep target first — a dep to a nonexistent card is a gating broken-cross-domain-dep
echo '{ "domain": { "overview": "사용자 알림 발송을 다루는 주제영역.",
  "scope": "IN: 푸시, 메일, 템플릿. OUT: 알림을 유발하는 사건의 판정(payment 등 발신 도메인)." } }' \
  | ed card create notification --type domain --summary "알림 도메인" --from -

echo '{ "domain": {
  "overview": "결제 승인·정산·환불을 다루는 주제영역.",
  "scope": "IN: 승인, 정산, 환불, 결제수단 관리. OUT: 알림 발송(notification 도메인), 회원 관리(member 도메인).",
  "cross_domain_dependencies": [
    { "domain": "notification", "relationship": "invokes", "note": "결제 완료 알림 발송을 호출" }
  ]
} }' | ed card create payment --type domain --summary "결제 도메인" --from -

ed validate cards   # prove it: total 0
```

## Read

```bash
ed card get <key>                       # full card JSON incl. the domain namespace
ed card list --type domain              # all domains
ed card list --parent <key>             # a domain's briefs
ed card tree <key>                      # the domain's subtree
ed card context <key>                   # domain + upstream/downstream cards
```

## Update

Because `--patch` replaces the whole namespace, update is read-modify-write:
`ed card get` → edit the field(s) → send the full namespace back (including
`cross_domain_dependencies` if the card has them — omitting the optional array drops it).

```bash
echo '{ "domain": { "overview": "…unchanged…", "scope": "…edited…",
  "cross_domain_dependencies": [ { "domain": "notification", "relationship": "invokes" } ] } }' \
  | ed card update <key> --patch -

ed card update <key> --summary "…"            # summary only
ed card set-status <key> active --reason "…"  # re-runs the activation guard
```

## Delete

```bash
ed card delete <key> --yes          # children exist? --force detaches them (not deleted)
```

A domain with briefs under it is load-bearing — deleting it detaches those briefs from
the hierarchy. Re-parent or delete the briefs first unless detaching is intended. A
domain referenced by another domain's `cross_domain_dependencies` also needs `--force`,
which strips those dep entries from the referrers.

## Verify

After every create/update/delete, run `ed validate cards` and read the findings:

- `broken-cross-domain-dep` — a dep's target card doesn't exist (gating, at every
  status); create the target domain or drop the dep.
- `relationship-free-text` — a dep's `relationship` isn't `invokes`/`consumes`; move the
  prose to `note`.
- `empty-tree` — a non-draft domain has no children; add its first brief or set the
  domain back to `draft`.
- `bidirectional-cross-domain-dep` — two domains point deps at each other (a warning:
  it counts in `summary.total` but doesn't gate the exit code); it usually means the
  boundary is cut wrong — merge or re-cut (see **Carving**).

Fix and re-run until `summary.total` is `0`. Don't report the task done without a clean
validate.
