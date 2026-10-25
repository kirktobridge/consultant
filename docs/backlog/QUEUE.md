# Next up

1. **P24** — The queue is generated from the dependency graph, not ranked by hand. In
   your recorded order. Unblocks P55.
2. **P55** — ship.mjs writes the tracked docs as one transaction per change. In your
   recorded order. Unblocks no open entry.
3. **P39** — A one-sided conflict resolution stops with the builder's case for it. In
   your recorded order. Unblocks no open entry.
4. **P37** — next.mjs judges readiness one way, in both modes. In your recorded order.
   Unblocks no open entry.
5. **P52** — A build the owner hands back can be resumed through the claim gate.
   Unblocks P54.
