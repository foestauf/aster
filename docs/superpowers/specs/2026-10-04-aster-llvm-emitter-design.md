# LLVM emission and driver (L3)

Implements issue #36 and the approved LLVM backend design, section 4. No C emitter/runtime or language changes, and C remains the default.

`emit_llvm.aster` is a deterministic printer of the existing IR. Every local has a zero-initialized stack slot in the entry block. Bool registers are i1, storage is i8; strings are two-word aggregates; references are pointers. Explicit size/alignment calculations reproduce the C layout, including empty structs and maximum-size, maximum-alignment unions. Byte-offset GEPs avoid inventing a C-union LLVM representation.

Runtime calls follow clang 18's Linux x86_64 ABI. All 28 public declarations are tested against clang-generated declarations. Internal Aster calls consistently use LLVM value types. Wrapping operations have no nsw/nuw flags; zero and minus-one division cases branch before sdiv/srem. Unreachable terminators retain the C runtime diagnostic. No unproven alias, overflow, termination or pointer-bound attributes are added.

The driver embeds the same C runtime, writes program.ll into a private temporary directory and compiles with clang -O2 -flto -fuse-ld=lld. Failure and cleanup tests cover build/run. Text emission never invokes clang; explicit emission selects its representation regardless of the executable backend option.

The entire runnable golden corpus compares C and LLVM stdout, stderr and exit status. LLVM compilation verifies every module. A focused ABI fixture checks bool arrays, mixed-field padding, embedded NUL string values, shared struct aliases, empty structs and a nine-bool union variant that needs padding against an i64 variant. Existing arithmetic fixtures cover wraparound, INT64_MIN/-1, modulo -1 and zero-divisor panic.
