# LLVM L4 implementation plan

1. Preserve the existing C stage chain and byte oracle.
2. Check clang/lld major versions alongside the gcc/platform preflight.
3. Build SL1 with S1 --backend=llvm; build SL2 with SL1 --backend=llvm.
4. Compare LLVM(SL1) and LLVM(SL2) byte for byte; compare both C emissions against S0. Store representations and hashes.
5. Accept SL1 in the test-stage selector; run every stage-aware suite and enforce matching totals/no skips.
6. Run typecheck, lint, focused selector/orchestration tests and complete pnpm selfhost. Record proof results only after success.
7. Keep C as default and leave all remote branch/PR publication subject to explicit approval.
