# A role does not know where its session lives

`roleAgent` returns the opts a node hands its runner, and nothing else. It used to return a wrapper with a `sessionFile` computed by `roleSessionFile(artifactsDir, sessionKey, role)` — a Pi-shaped guess made before anything ran — and implement and conflict logged that guess before the turn started.

The guess cannot be repaired for both runners: Pi's location is contract-pinned, but dsh chooses its `sessionId` at run time and writes under `DSH_HOME`, so no correct pre-run path exists for it at all. Both adapters already report the truth on `PackAgentResult.sessionFile`, and no node read that value.

Now the node logs the path that came back from the turn. Pi loses its pre-turn line — the artifacts directory still answers `ls` and the contract pins the location — and a turn that threw reports no session, which is the honest answer.

Rejected: keeping the guessed field for Pi's convenience (the true value was already on the result, and two spellings is what drifted); adding a runner-owned pre-turn hint to the seam (new surface for a pointer the artifacts directory already answers); keeping the single-field `RoleAgent` wrapper after its field was gone.
