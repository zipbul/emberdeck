# Emberdeck

Emberdeck is an MCP tool package that manages design knowledge of a codebase in card units. Cards are linked to code symbols and form a dependency graph through inter-card relations. The goal is to maintain structural integrity of the design without human intervention during vibe coding.

## Mandatory: read cards before modifying code

Before modifying any source file, call `emberdeck_find_cards_by_symbol` or `emberdeck_pre_change_check` for the files you are about to change. If cards exist, read them with `emberdeck_get_card` and work within their constraints. After modification, run `emberdeck_validate_code_links` to detect broken links. Do not skip this even for small changes — a one-line fix can violate a cross-module contract.
