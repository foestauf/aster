# LLVM self-host proof (L4)

Implements issue #37 without changing the normal C build path.

The existing S0→S1→S2→S3→S4 C proof remains mandatory. The same S1 then builds the compiler using --backend=llvm to produce SL1, and SL1 builds SL2 using LLVM. SL1 and SL2 must emit identical LLVM for the full compiler closure, and both must emit C identical to S0. The proof stores both representations and their hashes in .selfhost.

All stage-aware conformance suites run against SL1, including direct LLVM parity and ABI tests, and their test totals must match the C stages. SL2 is a fixed-point witness, not a substitute for the SL1 stage-aware tests. The ordinary full suite still runs, and a skipped or failed test fails the proof.

The proof environment requires Linux x86_64, gcc 13, clang 18, lld 18 and Node >=24. This affects proof/testing only; C compilation and the normal path remain usable without clang. CI's proof job installs and selects the pinned LLVM toolchain. A successful record documents the actual compiler versions and both LLVM hashes.
