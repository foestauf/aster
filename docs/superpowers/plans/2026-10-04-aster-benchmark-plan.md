# L1 implementation and verification plan

1. Add five deterministic CPU-bound `.aster` execution workloads, checksummed
   outputs, workload sizing notes, and independent optional reference answers.
2. Add dependency-free Node 24 orchestration and an existing-toolchain-built
   monotonic-time / `wait4` measurement helper. Compile before timing; check one
   warmup and each of five default rotating, serial configuration rounds.
3. Build the compiler under each configuration; check byte-identical emission
   and validate every full rebuild's output compiler outside the timed interval.
4. Test statistics, expected-output checking, schedule rotation, configuration
   selection, CLI validation, report provenance and compiler-import boundaries.
5. Run typecheck/lint and focused tests; independently verify all workload
   checksums and compile/run every configured variant.
6. Once other compilation/testing is idle, run the pinned toolchain baseline
   and record raw samples, environment, source and compiler provenance. Flag
   deviations from the reference machine instead of claiming equivalence.
7. Review the report for correctness failures, missing samples and the exact
   whole-suite best-C choice. Leave compiler behavior/defaults untouched.
