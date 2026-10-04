# LLVM L2 implementation plan

Source of truth: issue #35 and the approved LLVM backend design, sections 2 and 3.

## Gate

L1's checked C baseline must be recorded before any compiler change. The normal backend remains C.

## Implementation and verification

1. Extend the self-hosted CLI argument record with a backend and emit stage. Accept `--backend=c|llvm` only for build/run and `--emit=c|llvm` only for build. Reject malformed/unknown values with usage status 2. Keep seed behavior unchanged (it rejects the new options).
2. Until L3 is present, the LLVM selections report `llvm backend not implemented yet`, status 2, before reading the input. Explicit C selects the same path as the default.
3. Document Linux x86_64, gcc 13, and LLVM-only clang 18/lld 18. Pin those compiler majors in Ubuntu 24.04 CI without making clang a runtime dependency of C compilation.
4. Test accepted C forms, LLVM stub errors, unknown values, command restrictions, seed rejection, and temporary-directory cleanup. Existing golden C behavior must be unchanged.
5. Publish an isolated draft L2 change based on L1. L3 replaces only the explicit stub, preserving parsing and error handling.
