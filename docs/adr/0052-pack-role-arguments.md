# A role's arguments are declared once, and the machine is read at the edge

`RoleShape` in `roles.ts` is the one declaration of what each role's call carries: implement takes `{ ticketId, skill }`, conflict `{ ticketId }`, review `{ axisIndex, base, axis }`, summary `{ base }`. `personaFor`, `PersonaArgs` and the `PersonaRest` conditional-tuple trick are gone; the four table entries call four concrete builders (`implementPersona(runner, skill)`, `conflictPersona()`, `reviewPersona(base, axis)`, `summaryPersona(base)`).

The two declarations could not be collapsed because `skill` is not a caller argument at all — it is a machine fact (the tdd tree under HOME). It now travels as an argument of the call: the composition root reads it once, visibly, where the opts are composed (`implement.ts`: `args: { ticketId, skill: readTddSkill() }`), and the table stays data — it reads no filesystem and imports no reader.

The read is unconditional for both runners, deliberately: a persona's bytes must not depend on which runner happens to need the body. Pi ignores the value (its session advertises the skill through the catalog), which costs one ~2.7KB read per implement call and keeps the two runners' personas identical. `skill` is a required field, so a forgotten call site fails the typecheck instead of silently losing the body.

Rejected: a conditional tuple to keep one dispatcher (it is what forced the double declaration); a runner-conditional or lazy read (the persona would then depend on the runner); passing a path instead of the tree (the builder would read the machine again, which is the wart this removes); keeping two declarations in sync by hand.
