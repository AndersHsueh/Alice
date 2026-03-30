# Non-Interactive Status

This directory is currently retained as an experimental / parked capability area.

Current status:
- Excluded from the main TypeScript build in `/Users/xueyuheng/research/Alice/tsconfig.json`
- Not part of Alice's current stable CLI/TUI runtime path
- Preserved for future automation, controller, and batch execution work

Why it is still here:
- It holds useful prior work for non-interactive execution flows
- Some pieces may later support daemon tasks, automations, or service APIs
- It should not be mistaken for production-ready code in the current build

Before re-enabling it:
- Reconcile imports with the present runtime architecture
- Re-run a focused compile and test pass for the entire subtree
- Decide whether it becomes stable product code or remains explicitly experimental
