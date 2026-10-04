# Plan: reject malformed UTF-8 source (#25)

Spec: `docs/superpowers/specs/2026-10-04-aster-source-encoding-design.md`.

1. **TS validator, test first.** `packages/asterc/src/driver/utf8.test.ts` (table + property against
   `TextDecoder` fatal), then `driver/utf8.ts`. Export from `index.ts`.
2. **TS loader and CLI.** `nodeHost.readFile` and `cli.ts` read bytes, validate, decode. Unit tests in
   `load.test.ts`/`cli.test.ts` for the root and import messages.
3. **Stage-aware suite.** `tests/source_encoding.test.ts`, added to `STAGE_SUITES`; it fails against S1 until step 4.
4. **Aster.** `utf8_invalid_at`/`utf8_reason` in `loader.aster`, used by `load_import` and `asterc.aster`'s `main`.
5. **The blind spot.** One strict-decode spawn helper in `tests/`, used by every parity suite that compares child
   output.
6. **Docs.** Language spec, contract §4.1, friction note.
7. **Verify.** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm selfhost`, then PR closing #25.
