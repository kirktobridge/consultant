# Next up

1. **P20** — entries as files, the queue in its own file. Ahead of P5 and P6 because
   both add backlog fields that P20 would otherwise have to migrate; P10 depends on it.
2. **P5** — defects as a third intake class. Extends the schema-check surface, so it
   follows P20 by preference rather than by dependency.
3. **P6** — split "merged" from "released". Independent of the others; available to
   a parallel session at any time.
4. **P8** — a review step in the loop. Placement, not construction, so it's cheap;
   nothing else waits on it.
5. **P15** — the loop drives git. Dependency-ready since P16 shipped, and written
   against the loop P18 left. Last only because it entered the queue last; its rank
   against the others is yours to call.
