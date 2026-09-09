# Blocked by may cross Feature folders

A Ticket may declare a Baseline Dependency on a Ticket in another Feature. The Orchestrator does not discover these edges; `/to-tickets` (or a human) writes them.

Ids are `<feature-slug>/<NN>` so `auth/02` and `web/02` do not collide. Same-Feature blockers may keep the short `NN` form.

Rejected: forbidding cross-Feature edges (the API+UI→integration diamond would have to live in one folder); inferring edges from the codebase.
