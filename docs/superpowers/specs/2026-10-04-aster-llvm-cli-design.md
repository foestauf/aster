# LLVM CLI surface (L2)

Implements issue #35 under the approved LLVM backend design. No default or language semantics change.

The self-hosted CLI adds an explicit backend (`c` by default) and output stage (`c` or `llvm`). `--backend` is a build/run-only option; `--emit` remains build-only. The emit stage is an explicit request for that representation, independent of the executable backend option. Repeated valid options follow the existing last-option-wins convention. Unknown values and check-command backend options are usage errors (2). The TypeScript seed retains its rejection behavior.

At the L2 checkpoint an LLVM selection is recognized but reports `llvm backend not implemented yet` (2). L3 replaces this temporary error with emission/building. C remains fully functional without clang. LLVM executable production requires Linux x86_64 clang 18 and lld 18; textual emission does not invoke clang.

The compiler-failure contract remains exit 3 with streamed tool stderr and `internal compiler error: C compiler 'clang' failed`. Existing C behavior and cleanup are regression-tested. Compiler-major checks and LLVM installation belong to the CI environment, not the C default path.
