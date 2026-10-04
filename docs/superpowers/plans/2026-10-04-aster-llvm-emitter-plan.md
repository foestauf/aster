# Aster LLVM emitter implementation plan

Scope: `packages/asterc-self/emit_llvm.aster` only, using the existing lowered IR and C runtime. The enclosing POC owns CLI, driver, benchmark, parity and fixed-point integration. Implementation starts only after the C benchmark baseline is recorded.

## Representations and layout

- Emit one deterministic module with explicit Linux x86_64 target triple and data layout.
- Every local is an entry-block alloca. Initialize non-parameters to the same zero value as the C emitter and store incoming parameters into their slots before branching to the first lowered block.
- Integers and payload-free enums use `i64`. Heap structs, arrays and payload enums use opaque `ptr`. Strings use `{ ptr, i64 }`. Booleans use `i1` as values and `i8` in local/array/object memory, with explicit conversions at each load/store boundary.
- Heap field access uses byte offsets through ordinary `getelementptr i8`, without `inbounds`. Size/alignment are fixed by the supported x86_64 C ABI: bool 1/1, int/tag/pointer 8/8, string 16/8.
- Struct field offsets align each field, and total size rounds to maximum alignment. The C emitter's empty struct has one byte.
- A variant payload is laid out as its own C struct. Union alignment is maximum member alignment; union size is the rounded largest variant size. A heap enum contains an 8-byte tag and the union, including final struct padding. This matters for variants containing only booleans as well as mixed bool/string/int payloads.
- Runtime allocation is zeroing, matching C object initialization and untouched union bytes. Array element stride is memory type size, including a one-byte bool stride and sixteen-byte string stride.

## Runtime ABI

`clang 18 -S -emit-llvm -O0 packages/asterc/runtime/aster_rt.c` was inspected before implementation. Runtime string parameters are separate `ptr, i64` arguments; returned strings are `{ ptr, i64 }`. Bool parameters and returns require `zeroext i1`; bool out-parameters point to one-byte storage. `aster_rt_args` accepts `i32, ptr`. Every public runtime prototype is declared in fixed header order; parameter optimization attributes are deliberately omitted. Aster-to-Aster calls use a consistent internal signature and may pass aggregate strings directly.

## Instructions and control flow

- Typed operand, load, store, pointer-offset and call helpers handle every `IrInstr` variant. Runtime calls share argument expansion so strings/bools cannot drift between ordinary builtins, file I/O and POSIX calls.
- Arithmetic uses plain wraparound `add`, `sub`, `mul`; negation uses `sub i64 0`. Signed comparisons use `icmp`; bool comparison is equivalent after widening or as `i1` equality.
- Internal division/remainder helper functions branch on zero and negative one before any `sdiv`/`srem`. Zero calls `aster_rt_panic_cstr("division by zero")`; negative one returns wrapping negation or zero. This avoids LLVM poison for `INT64_MIN / -1` and `% -1`.
- Each lowered block has a prefixed label; temporaries have per-function counters. `switch` widens bool discriminants to i64. Missing switch fallback and `IrTerm::Unreachable` call `aster_rt_unreachable()` before LLVM `unreachable`, preserving the C oracle's panic.
- The external `main` wrapper calls `aster_rt_args` only when required and truncates the Aster i64 return to i32.
- String literal globals encode each byte as a two-digit LLVM hexadecimal escape, including NUL, quotes, backslashes and non-ASCII bytes. Their explicit byte length is authoritative; empty strings remain legal zero-length arrays.

## Validation order

1. Typecheck the emitter with the unchanged bootstrap compiler; compile a temporary harness that imports it.
2. Emit and verify small scalar, string, struct, array and enum modules; compare stdout/stderr/status with C.
3. Verify all runtime ABI declarations against clang's runtime definitions, and exercise every entry point, especially aggregate returns, bool arguments and out-parameters.
4. Cover overflow, signed minimum division/remainder, zero division, byte strings, bool arrays/fields, mixed payload layout, argument forwarding and panic paths.
5. Verify every runnable corpus module and full C parity through the enclosing integration harness.
6. Compile the compiler via LLVM and verify LLVM and C fixed points. Repeat emission to confirm byte determinism.

No `nsw`, `nuw`, `inbounds`, `noalias` or speculative optimization attributes are added. C remains the default; no runtime redesign, seed LLVM emitter or merge/default switch is in scope.

## Emitter development verification

After the baseline-ready gate, the 549-line Aster-only emitter was implemented without modifying the C emitter or runtime.

- The unchanged C bootstrap compiled a temporary emitter harness successfully.
- A first program compiled and linked via clang 18 `-O2 -flto -fuse-ld=lld`, with identical output and no warnings.
- A verifier sweep accepted 134 modules under clang 18 `-Werror -c`, including runnable program roots, emitter fixtures and the compiler source. Eight library-only roots were correctly rejected by the front end; no accepted module failed LLVM verification.
- The C-built emitter harness emitted 2,918,380 bytes of LLVM for its own closure. Its LLVM-built counterpart emitted identical bytes for that same closure.
- Emitter layout calculations matched GCC 13 `sizeof`/`offsetof` for a mixed bool/string/bool/pointer struct, an empty struct, and a heap enum whose union combines nine bool fields with an i64 field. The enum occupies 24 bytes (the nine-byte payload rounds to sixteen under the union's eight-byte alignment).

These are emitter-level checks; the enclosing POC's committed tests and self-hosting report remain the authoritative full parity and driver-integration proof.
