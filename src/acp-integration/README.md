# ACP Integration Status

This directory is currently retained as an experimental / parked integration area.

Current status:
- Excluded from the main TypeScript build in `/Users/xueyuheng/research/Alice/tsconfig.json`
- Not part of Alice's current stable runtime path
- Kept for future ACP/session replay work and reference implementations

Why it is still here:
- It contains useful protocol and session-replay exploration work
- Some export and session concepts may be reused later
- Removing it now would lose context without improving the current product path

Before re-enabling it:
- Audit imports against the current `src/ui/**` and `src/shim/**` structure
- Fix compile errors and stale dependencies
- Decide whether it returns as stable runtime code or moves under an explicit `experimental/` namespace
