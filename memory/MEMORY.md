# Alice Project Memory

## Architecture

Alice CLI uses qwen-code's Ink/React TUI connected to Alice's own daemon backend via a shim/adapter layer.

```
qwen-code TUI (src/ui/) → Shim/Adapter (src/shim/) → Alice DaemonClient (src/utils/daemonClient.ts) → Alice Daemon (src/daemon/)
```

## Key Files

- `src/index.tsx` — Entry point (Ink TUI mode + `-p` one-shot mode)
- `src/shim/qwen-code-core.ts` — Full stub for `@qwen-code/qwen-code-core`
- `src/shim/hooks/useAliceStream.ts` — Replaces `useGeminiStream`, connects to DaemonClient
- `src/ui/AppContainer.tsx` — Modified single line: imports `useAliceStream as useGeminiStream`
- `src/utils/daemonClient.ts` — Streams chat events from Alice daemon
- `src/daemon/` — Alice backend (unchanged)

## Build Status (2026-03-23)

- `npm run build` succeeds with `noEmitOnError: false` (866 errors in unused qwen-code files)
- `src/index.tsx`, `src/shim/`, `src/ui/AppContainer.tsx` compile with 0 errors
- `dist/index.js` is built and executable
- Daemon is running, full chat stream pipeline verified working
- `npm run dev -- --help` works correctly

## tsconfig.json Notes

- `strict: false, noImplicitAny: false, noEmitOnError: false` — required to build despite qwen-code file errors
- `jsx: "react-jsx"` — for Ink/React
- paths: `@qwen-code/qwen-code-core` → `./src/shim/qwen-code-core.ts`
- Excluded: `src/acp-integration/**/*`, `src/nonInteractive/**/*`, `useGeminiStream.ts`

## Daemon

- Runs at `dist/daemon/index.js` (separate process)
- Default model: `xai-grok4-0709`
- DaemonClient connects via HTTP/socket
- ChatStreamEvent types: `text`, `tool_call`, `done`, `error`
- ToolCallRecord fields: `id`, `toolName`, `params`, `result`, `status`

## Phase Status

- Phase 1 (Infrastructure): ✅ Complete
- Phase 2 (Type stubs): ✅ Complete
- Phase 3 (Core adapters): ✅ Complete
- Phase 4 (Integration): ✅ Complete
- Phase 5 (E2E testing): Daemon connectivity verified ✅, TUI interactive test pending
- Phase 6 (Cleanup): Not started
