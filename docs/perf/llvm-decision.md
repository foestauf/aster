# Aster C / LLVM benchmark record

This is a measurement of the machine and inputs named below. Deviations are explicit; it is not automatically a certified reference-machine result.

## Decision: keep C as the default

The observed median results fail all three promotion gates. LLVM is 1.037× faster across the runtime suite than the best whole-suite C configuration (C+LTO), below the required 1.10×. Its full self-build is 8.65% slower, and three runtime workloads regress by more than 5%. Sorting's 5.21% regression is only narrowly beyond the gate and particularly sensitive to the measured noise; integer loops regress 30.06%. Cloud variability remains substantial despite CPU pinning, so the stable performance conclusion is **inconclusive**, rather than a reliable claim of a small overall win or loss. There is no evidence here to promote LLVM to the default.

LLVM remains an explicit experimental backend. Correctness is supported by the golden parity, runtime ABI and complete C/LLVM self-host proof; benchmark output checks alone are not that proof. C remains the normal build path and default backend.

Memory is also workload-dependent: struct/enum churn's median peak RSS falls from 125,696 to 63,232 KiB, but LLVM full self-build's peak rises from 247,974 to 465,594 KiB, about **1.878×** the C+LTO peak. These are Linux wait4 per-process/descendant maxima, not summed simultaneous process-tree memory. As a conservative additional comparison, the fastest observed C full self-build is C-O2 at 4,481.313 ms; LLVM at 4,966.135 ms is about 10.82% slower than that configuration too.

No default switch or speculative optimization attributes were adopted. Useful targeted next experiments would profile integer arithmetic and compiler/LTO cost, then repeat the frozen suite on a quieter reference machine before deciding whether an optimization is a real improvement.

## LTO inspection

For `bench/array_sort.aster`, the verified LLVM source had 16 calls to `aster_rt_array_at` and one call to `aster_rt_array_push_slot`. Linking with the planned `clang -O2 -flto -fuse-ld=lld` pipeline and inspecting lld's saved optimized bitcode left zero calls to either helper. The runtime boundary is therefore being optimized; that alone did not meet the performance gates.

Reproduce the diagnostic (it does not alter the measured driver flags):

```sh
build/asterc build bench/array_sort.aster --emit=llvm > array_sort.ll
clang -O2 -flto -fuse-ld=lld -Wl,--save-temps -std=c11 -Wall array_sort.ll packages/asterc/runtime/aster_rt.c -I packages/asterc/runtime -o array_sort
clang -S -emit-llvm array_sort.0.4.opt.bc -o optimized.ll
grep -c 'call.*@aster_rt_array_at' array_sort.ll optimized.ll
grep -c 'call.*@aster_rt_array_push_slot' array_sort.ll optimized.ll
```

```text
Aster benchmark report
recorded    2026-10-04T22:32:22.315Z
git commit  aa2a3bcf6defdaa2137e7737f66799d9c3b1f5cf (dirty: no)
source rev  6839d353899001b0ce966c0b5e3b54cf40051352
input hash  55caf8d441b0a2fa752ebe914bb75a98030ccde0a9ed8b47817ef9c28e350e3f
compiler    8434402653a413ea600fd7c9a127023560482d6f1e78cea897ea6e446334d9ea
platform    Linux x86_64; Debian GNU/Linux 13 (trixie)
CPU         AMD EPYC 9V74 80-Core Processor (9 visible logical CPUs); governor: unavailable
affinity    0
cc          gcc-13 (Debian 13.3.0-16) 13.3.0
clang       Debian clang version 18.1.8 (++20240731024826+3b5b5c1ec4a3-1~exp1~20240731144843.145)
lld         Debian LLD 18.1.8 (compatible with GNU linkers)
node        v24.19.0
note        Development cloud measurement on Debian 13, not the Ubuntu 24.04 reference machine. GCC 13.3, clang 18.1.8 and lld 18.1.8 pinned from official vendor packages. Entire benchmark and descendants pinned to CPU 0. Remote source revision 6839d353899001b0ce966c0b5e3b54cf40051352 was verified against all 396 local tracked file blobs; local HEAD differs only by the subsequently recorded self-host proof document. Upstream base d668d8e18cb70087ae88799317cedd547c32b6d7. Fresh combined C and LLVM measurements; no prior baseline samples reused. No other assistant compile/test jobs during samples. Full conformance and LLVM self-host fixed-point proof passed before this run.
DEVIATION   reference CI OS is Ubuntu 24.04; this machine differs

Each case: 1 checked warmup + 10 checked timed runs; serial, rotating configuration order.
Wall time: CLOCK_MONOTONIC around fork/exec/wait. Peak RSS: Linux wait4 ru_maxrss (KiB).
RSS includes waited-for descendants, taking the largest individual process peak, not a simultaneous total.
Medians exclude warmups. Raw samples and all build commands are in .bench/report.json.

benchmark              configuration  median wall ms  median peak RSS KiB
array_sort             c-O2                  227.111                 2688
array_sort             c-O3                  244.212                 2688
array_sort             c-lto                 108.594                 2688
array_sort             llvm                  114.248                 2688
calc_interpreter       c-O2                   90.292                74752
calc_interpreter       c-O3                   82.001                74752
calc_interpreter       c-lto                  77.097                74752
calc_interpreter       llvm                   82.871                74752
integer_loops          c-O2                  162.924                  512
integer_loops          c-O3                  159.982                  512
integer_loops          c-lto                 162.330                  512
integer_loops          llvm                  211.129                  512
string_build           c-O2                  167.117               145024
string_build           c-O3                  157.672               145024
string_build           c-lto                 155.391               145024
string_build           llvm                  147.227               145024
struct_enum            c-O2                  127.621               125696
struct_enum            c-O3                  130.553               125696
struct_enum            c-lto                 122.276               125696
struct_enum            llvm                   73.171                63232
self-emit-c            c-O2                  173.428               246820
self-emit-c            c-O3                  183.863               246816
self-emit-c            c-lto                 167.874               246756
self-emit-c            llvm                  158.066               245286
self-build             c-O2                 4481.313               247972
self-build             c-O3                 4617.116               248088
self-build             c-lto                4570.718               247974
self-build             llvm                 4966.135               465594

Suite selection: geometric mean of the 5 runtime speedups over c-O2; self-compile rows excluded.
  c-O2: 1.0000x
  c-O3: 1.0156x
  c-lto: 1.2251x
  llvm: 1.2704x
Best measured whole-suite C configuration: c-lto.

self-emit-c: each configured compiler emits its own C; output must be byte-identical to the oracle.
self-build: each configured compiler completes a native rebuild; the rebuilt compiler must reproduce the C oracle.
C self-build uses the unchanged driver (cc -O2) for the child binary, even when the running compiler is c-O3/c-lto.
LLVM self-build selects --backend=llvm. Validation of rebuilt binaries is outside the measured interval.

L5 performance decision: INCONCLUSIVE
Measured gates are shown, but sample quality requires a fresh, quieter combined run before a performance conclusion.
Measured median gates (c-lto is the whole-suite C comparator):
  suite speedup: 1.0370x >= 1.10x: FAIL
  self-build speedup: 0.9204x >= 1.00x (not slower): FAIL
  every runtime regression <= 5%: FAIL
  all three measured gates: FAIL
  array_sort: LLVM/c-lto speedup 0.9505x; regression 5.21%; FAIL; fastest individual C c-lto, speedup 0.9505x (diagnostic only)
  calc_interpreter: LLVM/c-lto speedup 0.9303x; regression 7.49%; FAIL; fastest individual C c-lto, speedup 0.9303x (diagnostic only)
  integer_loops: LLVM/c-lto speedup 0.7689x; regression 30.06%; FAIL; fastest individual C c-O3, speedup 0.7577x (diagnostic only)
  string_build: LLVM/c-lto speedup 1.0554x; regression -5.25%; PASS; fastest individual C c-lto, speedup 1.0554x (diagnostic only)
  struct_enum: LLVM/c-lto speedup 1.6711x; regression -40.16%; PASS; fastest individual C c-lto, speedup 1.6711x (diagnostic only)
Stability heuristic: (max-min)/median > 20% flags noise; at least five timed samples are required.
This is a conservative warning heuristic, not a confidence interval or an extra speed threshold.
  NOISE array_sort/c-O2: 209.932..296.215 ms; spread 38.0%
  NOISE array_sort/c-O3: 211.509..305.357 ms; spread 38.4%
  NOISE array_sort/c-lto: 94.907..140.552 ms; spread 42.0%
  NOISE array_sort/llvm: 103.298..269.691 ms; spread 145.6%
  NOISE calc_interpreter/c-O2: 81.187..249.754 ms; spread 186.7%
  NOISE calc_interpreter/c-O3: 71.541..105.580 ms; spread 41.5%
  NOISE calc_interpreter/c-lto: 68.878..109.428 ms; spread 52.6%
  NOISE calc_interpreter/llvm: 74.060..105.334 ms; spread 37.7%
  NOISE integer_loops/c-O2: 151.438..187.370 ms; spread 22.1%
  NOISE integer_loops/c-O3: 153.441..186.822 ms; spread 20.9%
  NOISE integer_loops/c-lto: 157.420..198.624 ms; spread 25.4%
  NOISE integer_loops/llvm: 186.297..240.443 ms; spread 25.6%
  NOISE string_build/c-O2: 129.364..331.704 ms; spread 121.1%
  NOISE string_build/c-O3: 128.494..168.408 ms; spread 25.3%
  NOISE string_build/c-lto: 140.211..251.088 ms; spread 71.4%
  NOISE string_build/llvm: 136.069..359.628 ms; spread 151.8%
  NOISE struct_enum/c-lto: 106.529..217.124 ms; spread 90.4%
  NOISE struct_enum/llvm: 65.385..81.222 ms; spread 21.6%
  NOISE self-emit-c/c-O2: 155.176..193.473 ms; spread 22.1% (emission-only diagnostic, not a gate)
  NOISE self-emit-c/c-O3: 155.566..351.069 ms; spread 106.3% (emission-only diagnostic, not a gate)
  NOISE self-emit-c/c-lto: 149.415..200.428 ms; spread 30.4% (emission-only diagnostic, not a gate)
  NOISE self-emit-c/llvm: 140.120..378.414 ms; spread 150.8% (emission-only diagnostic, not a gate)
  NOISE self-build/c-O3: 4226.920..5296.598 ms; spread 23.2%
  QUALITY array_sort/c-O2: (max-min)/median is 38.0%, above 20%
  QUALITY array_sort/c-O3: (max-min)/median is 38.4%, above 20%
  QUALITY array_sort/c-lto: (max-min)/median is 42.0%, above 20%
  QUALITY array_sort/llvm: (max-min)/median is 145.6%, above 20%
  QUALITY calc_interpreter/c-O2: (max-min)/median is 186.7%, above 20%
  QUALITY calc_interpreter/c-O3: (max-min)/median is 41.5%, above 20%
  QUALITY calc_interpreter/c-lto: (max-min)/median is 52.6%, above 20%
  QUALITY calc_interpreter/llvm: (max-min)/median is 37.7%, above 20%
  QUALITY integer_loops/c-O2: (max-min)/median is 22.1%, above 20%
  QUALITY integer_loops/c-O3: (max-min)/median is 20.9%, above 20%
  QUALITY integer_loops/c-lto: (max-min)/median is 25.4%, above 20%
  QUALITY integer_loops/llvm: (max-min)/median is 25.6%, above 20%
  QUALITY string_build/c-O2: (max-min)/median is 121.1%, above 20%
  QUALITY string_build/c-O3: (max-min)/median is 25.3%, above 20%
  QUALITY string_build/c-lto: (max-min)/median is 71.4%, above 20%
  QUALITY string_build/llvm: (max-min)/median is 151.8%, above 20%
  QUALITY struct_enum/c-lto: (max-min)/median is 90.4%, above 20%
  QUALITY struct_enum/llvm: (max-min)/median is 21.6%, above 20%
Self-emission is reported separately and is not substituted for the full self-build gate.
Platform/provenance caveats still apply. No compiler defaults are changed by this report.

Benchmark output checks: PASS
```

## Reproduce

Use the source revision and benchmark inputs identified above. Install the recorded toolchain first: gcc 13 as `cc`, Node 24+, and clang/lld 18 when measuring LLVM.
Put the matching toolchain directory first in `PATH` for both bootstrap and the benchmark. On this development machine it was `/tmp/aster-toolchain-bin`; that temporary directory is not an install instruction for another machine.

```sh
# Replace this with your installed gcc-13 / clang-18 / lld-18 wrapper directory.
export PATH="/path/to/pinned-toolchain/bin:$PATH"
cc --version
clang --version
ld.lld --version
pnpm bootstrap
# Recorded CPU affinity; choose an allowed equivalent CPU set if this machine differs.
taskset -c '0' pnpm bench '--runs=10' '--configs=c-O2,c-O3,c-lto,llvm' '--record=llvm-decision' '--compiler=build/asterc' '--source-revision=6839d353899001b0ce966c0b5e3b54cf40051352' '--environment-note=Development cloud measurement on Debian 13, not the Ubuntu 24.04 reference machine. GCC 13.3, clang 18.1.8 and lld 18.1.8 pinned from official vendor packages. Entire benchmark and descendants pinned to CPU 0. Remote source revision 6839d353899001b0ce966c0b5e3b54cf40051352 was verified against all 396 local tracked file blobs; local HEAD differs only by the subsequently recorded self-host proof document. Upstream base d668d8e18cb70087ae88799317cedd547c32b6d7. Fresh combined C and LLVM measurements; no prior baseline samples reused. No other assistant compile/test jobs during samples. Full conformance and LLVM self-host fixed-point proof passed before this run.'
```

Use a fresh combined `--configs=c-O2,c-O3,c-lto,llvm` run for L5. Never splice LLVM samples into this earlier C baseline.

## Raw samples

### array_sort / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 238.538432 | 2688 | yes |
| 1 | no | 288.441713 | 2688 | yes |
| 2 | no | 225.553394 | 2688 | yes |
| 3 | no | 210.247857 | 2688 | yes |
| 4 | no | 257.636673 | 2688 | yes |
| 5 | no | 228.669134 | 2688 | yes |
| 6 | no | 209.931864 | 2688 | yes |
| 7 | no | 232.092552 | 2688 | yes |
| 8 | no | 222.019830 | 2688 | yes |
| 9 | no | 296.215431 | 2688 | yes |
| 10 | no | 210.121819 | 2688 | yes |

### array_sort / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 233.325224 | 2688 | yes |
| 1 | no | 305.356650 | 2688 | yes |
| 2 | no | 228.209292 | 2688 | yes |
| 3 | no | 211.508990 | 2688 | yes |
| 4 | no | 243.873050 | 2688 | yes |
| 5 | no | 256.151634 | 2688 | yes |
| 6 | no | 238.196077 | 2688 | yes |
| 7 | no | 260.748605 | 2688 | yes |
| 8 | no | 273.892574 | 2688 | yes |
| 9 | no | 244.550174 | 2688 | yes |
| 10 | no | 212.620074 | 2688 | yes |

### array_sort / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 107.645476 | 2688 | yes |
| 1 | no | 140.551911 | 2688 | yes |
| 2 | no | 131.648034 | 2688 | yes |
| 3 | no | 95.500090 | 2688 | yes |
| 4 | no | 109.184450 | 2688 | yes |
| 5 | no | 99.925575 | 2688 | yes |
| 6 | no | 116.809766 | 2688 | yes |
| 7 | no | 111.757248 | 2688 | yes |
| 8 | no | 97.912241 | 2688 | yes |
| 9 | no | 108.003831 | 2688 | yes |
| 10 | no | 94.906700 | 2688 | yes |

### array_sort / llvm

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 129.021479 | 2688 | yes |
| 1 | no | 145.342049 | 2688 | yes |
| 2 | no | 113.001570 | 2688 | yes |
| 3 | no | 104.308810 | 2688 | yes |
| 4 | no | 200.672909 | 2688 | yes |
| 5 | no | 269.691206 | 2688 | yes |
| 6 | no | 115.079428 | 2688 | yes |
| 7 | no | 199.135811 | 2688 | yes |
| 8 | no | 109.070049 | 2688 | yes |
| 9 | no | 113.417459 | 2688 | yes |
| 10 | no | 103.298483 | 2688 | yes |

### calc_interpreter / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 102.577185 | 74752 | yes |
| 1 | no | 249.753681 | 74752 | yes |
| 2 | no | 88.818769 | 74752 | yes |
| 3 | no | 153.502071 | 74752 | yes |
| 4 | no | 110.136469 | 74752 | yes |
| 5 | no | 81.310033 | 74752 | yes |
| 6 | no | 91.764871 | 74752 | yes |
| 7 | no | 98.421028 | 74752 | yes |
| 8 | no | 86.314169 | 74752 | yes |
| 9 | no | 86.617291 | 74752 | yes |
| 10 | no | 81.187092 | 74752 | yes |

### calc_interpreter / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 120.632544 | 74752 | yes |
| 1 | no | 101.928505 | 74752 | yes |
| 2 | no | 88.167477 | 74752 | yes |
| 3 | no | 77.255587 | 74752 | yes |
| 4 | no | 77.255206 | 74752 | yes |
| 5 | no | 91.766498 | 74752 | yes |
| 6 | no | 78.892395 | 74752 | yes |
| 7 | no | 81.473188 | 74752 | yes |
| 8 | no | 82.527836 | 74752 | yes |
| 9 | no | 105.580427 | 74752 | yes |
| 10 | no | 71.541230 | 74752 | yes |

### calc_interpreter / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 108.737184 | 74752 | yes |
| 1 | no | 89.427572 | 74752 | yes |
| 2 | no | 92.151278 | 74752 | yes |
| 3 | no | 74.122795 | 74752 | yes |
| 4 | no | 68.877532 | 74752 | yes |
| 5 | no | 70.169151 | 74752 | yes |
| 6 | no | 109.428152 | 74752 | yes |
| 7 | no | 80.071321 | 74752 | yes |
| 8 | no | 89.203353 | 74752 | yes |
| 9 | no | 73.996989 | 74752 | yes |
| 10 | no | 69.396143 | 74752 | yes |

### calc_interpreter / llvm

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 77.297355 | 74752 | yes |
| 1 | no | 94.147131 | 74752 | yes |
| 2 | no | 79.900590 | 74752 | yes |
| 3 | no | 74.326462 | 74752 | yes |
| 4 | no | 86.353251 | 74752 | yes |
| 5 | no | 74.059530 | 74752 | yes |
| 6 | no | 105.334005 | 74752 | yes |
| 7 | no | 105.272930 | 74752 | yes |
| 8 | no | 85.841149 | 74752 | yes |
| 9 | no | 78.982032 | 74752 | yes |
| 10 | no | 75.588047 | 74752 | yes |

### integer_loops / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 159.062273 | 512 | yes |
| 1 | no | 156.268789 | 512 | yes |
| 2 | no | 159.423995 | 512 | yes |
| 3 | no | 151.437503 | 512 | yes |
| 4 | no | 162.940425 | 512 | yes |
| 5 | no | 162.906797 | 512 | yes |
| 6 | no | 172.414765 | 512 | yes |
| 7 | no | 187.369755 | 512 | yes |
| 8 | no | 163.945251 | 512 | yes |
| 9 | no | 163.244784 | 512 | yes |
| 10 | no | 155.955563 | 512 | yes |

### integer_loops / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 159.385117 | 512 | yes |
| 1 | no | 157.866897 | 512 | yes |
| 2 | no | 160.748245 | 512 | yes |
| 3 | no | 153.440932 | 512 | yes |
| 4 | no | 165.242810 | 512 | yes |
| 5 | no | 155.814341 | 512 | yes |
| 6 | no | 183.769213 | 512 | yes |
| 7 | no | 186.822403 | 512 | yes |
| 8 | no | 166.059148 | 512 | yes |
| 9 | no | 155.676076 | 512 | yes |
| 10 | no | 159.216243 | 512 | yes |

### integer_loops / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 163.309036 | 512 | yes |
| 1 | no | 161.625148 | 512 | yes |
| 2 | no | 181.118965 | 512 | yes |
| 3 | no | 158.880539 | 512 | yes |
| 4 | no | 182.784981 | 512 | yes |
| 5 | no | 158.779461 | 512 | yes |
| 6 | no | 178.501833 | 512 | yes |
| 7 | no | 198.624406 | 512 | yes |
| 8 | no | 161.077180 | 512 | yes |
| 9 | no | 163.034898 | 512 | yes |
| 10 | no | 157.420225 | 512 | yes |

### integer_loops / llvm

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 200.805104 | 512 | yes |
| 1 | no | 191.894706 | 512 | yes |
| 2 | no | 209.345452 | 512 | yes |
| 3 | no | 186.297241 | 512 | yes |
| 4 | no | 206.142698 | 512 | yes |
| 5 | no | 197.910255 | 512 | yes |
| 6 | no | 240.442781 | 512 | yes |
| 7 | no | 231.682898 | 512 | yes |
| 8 | no | 221.071946 | 512 | yes |
| 9 | no | 213.893012 | 512 | yes |
| 10 | no | 212.913022 | 512 | yes |

### string_build / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 151.114957 | 145024 | yes |
| 1 | no | 174.496550 | 145024 | yes |
| 2 | no | 293.126921 | 145024 | yes |
| 3 | no | 159.737259 | 145024 | yes |
| 4 | no | 148.838108 | 145024 | yes |
| 5 | no | 331.704446 | 145024 | yes |
| 6 | no | 158.334202 | 145024 | yes |
| 7 | no | 194.012593 | 145024 | yes |
| 8 | no | 178.006874 | 145024 | yes |
| 9 | no | 156.154058 | 145024 | yes |
| 10 | no | 129.364120 | 145024 | yes |

### string_build / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 142.766689 | 145024 | yes |
| 1 | no | 161.015282 | 145024 | yes |
| 2 | no | 142.736182 | 145024 | yes |
| 3 | no | 164.386194 | 145024 | yes |
| 4 | no | 154.918794 | 145024 | yes |
| 5 | no | 168.407899 | 145024 | yes |
| 6 | no | 160.425293 | 145024 | yes |
| 7 | no | 147.562112 | 145024 | yes |
| 8 | no | 149.708875 | 145024 | yes |
| 9 | no | 166.269331 | 145024 | yes |
| 10 | no | 128.494412 | 145024 | yes |

### string_build / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 132.991131 | 145024 | yes |
| 1 | no | 151.731198 | 145024 | yes |
| 2 | no | 140.620607 | 145024 | yes |
| 3 | no | 148.389463 | 145024 | yes |
| 4 | no | 140.210518 | 145024 | yes |
| 5 | no | 182.610085 | 145024 | yes |
| 6 | no | 251.087969 | 145024 | yes |
| 7 | no | 141.531361 | 145024 | yes |
| 8 | no | 159.049948 | 145024 | yes |
| 9 | no | 163.168319 | 145024 | yes |
| 10 | no | 164.147491 | 145024 | yes |

### string_build / llvm

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 131.530348 | 145024 | yes |
| 1 | no | 146.263863 | 145024 | yes |
| 2 | no | 148.190388 | 145024 | yes |
| 3 | no | 137.302435 | 145024 | yes |
| 4 | no | 136.068871 | 145024 | yes |
| 5 | no | 167.281418 | 145024 | yes |
| 6 | no | 173.546443 | 145024 | yes |
| 7 | no | 359.627682 | 145024 | yes |
| 8 | no | 145.466884 | 145024 | yes |
| 9 | no | 153.334631 | 145024 | yes |
| 10 | no | 137.347355 | 145024 | yes |

### struct_enum / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 115.544689 | 125696 | yes |
| 1 | no | 136.272733 | 125696 | yes |
| 2 | no | 121.558437 | 125696 | yes |
| 3 | no | 135.628361 | 125696 | yes |
| 4 | no | 120.187294 | 125696 | yes |
| 5 | no | 127.922667 | 125696 | yes |
| 6 | no | 117.292380 | 125696 | yes |
| 7 | no | 123.014873 | 125696 | yes |
| 8 | no | 135.817908 | 125696 | yes |
| 9 | no | 142.569593 | 125696 | yes |
| 10 | no | 127.319156 | 125696 | yes |

### struct_enum / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 116.672462 | 125696 | yes |
| 1 | no | 138.767397 | 125696 | yes |
| 2 | no | 130.260183 | 125696 | yes |
| 3 | no | 140.536944 | 125696 | yes |
| 4 | no | 117.992640 | 125696 | yes |
| 5 | no | 138.071921 | 125696 | yes |
| 6 | no | 119.649537 | 125696 | yes |
| 7 | no | 117.933293 | 125696 | yes |
| 8 | no | 130.845901 | 125696 | yes |
| 9 | no | 128.306761 | 125696 | yes |
| 10 | no | 141.229317 | 125696 | yes |

### struct_enum / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 112.677547 | 125696 | yes |
| 1 | no | 129.229487 | 125696 | yes |
| 2 | no | 114.347566 | 125696 | yes |
| 3 | no | 121.152179 | 125696 | yes |
| 4 | no | 200.756464 | 125696 | yes |
| 5 | no | 122.678756 | 125696 | yes |
| 6 | no | 121.872778 | 125696 | yes |
| 7 | no | 111.017526 | 125696 | yes |
| 8 | no | 129.662157 | 125696 | yes |
| 9 | no | 217.123679 | 125696 | yes |
| 10 | no | 106.528680 | 125696 | yes |

### struct_enum / llvm

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 72.614347 | 63232 | yes |
| 1 | no | 75.410777 | 63232 | yes |
| 2 | no | 75.989612 | 63232 | yes |
| 3 | no | 76.328192 | 63232 | yes |
| 4 | no | 67.334691 | 63232 | yes |
| 5 | no | 73.144087 | 63232 | yes |
| 6 | no | 73.198255 | 63232 | yes |
| 7 | no | 68.537951 | 63232 | yes |
| 8 | no | 81.222142 | 63232 | yes |
| 9 | no | 70.959372 | 63232 | yes |
| 10 | no | 65.384521 | 63232 | yes |

### self-emit-c / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 230.085313 | 246832 | yes |
| 1 | no | 168.179859 | 246832 | yes |
| 2 | no | 173.944029 | 246820 | yes |
| 3 | no | 178.199290 | 246820 | yes |
| 4 | no | 160.407229 | 246816 | yes |
| 5 | no | 165.863114 | 246812 | yes |
| 6 | no | 186.515946 | 246820 | yes |
| 7 | no | 193.473086 | 246816 | yes |
| 8 | no | 172.912677 | 246804 | yes |
| 9 | no | 155.176438 | 246820 | yes |
| 10 | no | 179.506109 | 246828 | yes |

### self-emit-c / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 176.842615 | 246816 | yes |
| 1 | no | 351.068780 | 246808 | yes |
| 2 | no | 158.499524 | 246808 | yes |
| 3 | no | 189.324687 | 246808 | yes |
| 4 | no | 155.565727 | 246832 | yes |
| 5 | no | 184.682127 | 246808 | yes |
| 6 | no | 176.830959 | 246832 | yes |
| 7 | no | 183.044037 | 246832 | yes |
| 8 | no | 155.799939 | 246808 | yes |
| 9 | no | 195.161564 | 246832 | yes |
| 10 | no | 322.835980 | 246824 | yes |

### self-emit-c / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 149.066214 | 246824 | yes |
| 1 | no | 200.428007 | 246700 | yes |
| 2 | no | 191.710133 | 246704 | yes |
| 3 | no | 167.822683 | 246800 | yes |
| 4 | no | 193.089951 | 246800 | yes |
| 5 | no | 182.810447 | 246824 | yes |
| 6 | no | 162.844887 | 246804 | yes |
| 7 | no | 162.945078 | 246712 | yes |
| 8 | no | 149.415318 | 246700 | yes |
| 9 | no | 155.970398 | 246816 | yes |
| 10 | no | 167.924917 | 246704 | yes |

### self-emit-c / llvm

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 124.679277 | 245268 | yes |
| 1 | no | 170.242700 | 245276 | yes |
| 2 | no | 150.071041 | 245288 | yes |
| 3 | no | 378.413625 | 245260 | yes |
| 4 | no | 141.382108 | 245288 | yes |
| 5 | no | 168.693053 | 245304 | yes |
| 6 | no | 318.293944 | 245304 | yes |
| 7 | no | 160.870714 | 245284 | yes |
| 8 | no | 140.119563 | 245272 | yes |
| 9 | no | 148.087151 | 245304 | yes |
| 10 | no | 155.260579 | 245280 | yes |

### self-build / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 4453.965710 | 247984 | yes |
| 1 | no | 4293.178457 | 247972 | yes |
| 2 | no | 4516.314813 | 247984 | yes |
| 3 | no | 4289.088544 | 247972 | yes |
| 4 | no | 4589.377811 | 247972 | yes |
| 5 | no | 4818.863997 | 247984 | yes |
| 6 | no | 4349.171582 | 247972 | yes |
| 7 | no | 4437.210550 | 247972 | yes |
| 8 | no | 4709.316818 | 247980 | yes |
| 9 | no | 4668.151084 | 247964 | yes |
| 10 | no | 4446.311954 | 247984 | yes |

### self-build / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 4682.633966 | 248088 | yes |
| 1 | no | 4532.764502 | 248088 | yes |
| 2 | no | 4465.884854 | 248088 | yes |
| 3 | no | 4226.920082 | 248088 | yes |
| 4 | no | 5166.627244 | 248088 | yes |
| 5 | no | 4701.467805 | 248088 | yes |
| 6 | no | 5296.597704 | 247984 | yes |
| 7 | no | 4884.874543 | 247968 | yes |
| 8 | no | 4405.072666 | 248088 | yes |
| 9 | no | 4531.532622 | 247984 | yes |
| 10 | no | 4819.187260 | 248088 | yes |

### self-build / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 4552.553301 | 247960 | yes |
| 1 | no | 4859.607165 | 247968 | yes |
| 2 | no | 4340.437204 | 247988 | yes |
| 3 | no | 4415.200211 | 247984 | yes |
| 4 | no | 4628.089855 | 247968 | yes |
| 5 | no | 4573.419623 | 247960 | yes |
| 6 | no | 4373.472303 | 247984 | yes |
| 7 | no | 4663.462608 | 247956 | yes |
| 8 | no | 4391.725577 | 247984 | yes |
| 9 | no | 4606.263252 | 247980 | yes |
| 10 | no | 4568.015685 | 247952 | yes |

### self-build / llvm

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 6225.585485 | 465684 | yes |
| 1 | no | 5264.548338 | 465684 | yes |
| 2 | no | 5075.660200 | 465596 | yes |
| 3 | no | 4931.026682 | 465688 | yes |
| 4 | no | 5134.719150 | 465592 | yes |
| 5 | no | 4684.853213 | 465592 | yes |
| 6 | no | 5001.242724 | 465592 | yes |
| 7 | no | 5006.804714 | 465592 | yes |
| 8 | no | 4769.910487 | 465684 | yes |
| 9 | no | 4618.570090 | 465676 | yes |
| 10 | no | 4737.615607 | 465588 | yes |

## Exact run data

The JSON includes source checksums, expected output, compiler provenance, commands and all samples.

```json
{
  "schemaVersion": 1,
  "environment": {
    "recordedAt": "2026-10-04T22:32:22.315Z",
    "gitCommit": "aa2a3bcf6defdaa2137e7737f66799d9c3b1f5cf",
    "gitDirty": false,
    "sourceRevision": "6839d353899001b0ce966c0b5e3b54cf40051352",
    "inputSha256": "55caf8d441b0a2fa752ebe914bb75a98030ccde0a9ed8b47817ef9c28e350e3f",
    "compilerSha256": "8434402653a413ea600fd7c9a127023560482d6f1e78cea897ea6e446334d9ea",
    "uname": "Linux x86_64",
    "osRelease": "Debian GNU/Linux 13 (trixie)",
    "cpu": "AMD EPYC 9V74 80-Core Processor",
    "cpuCount": 9,
    "cpuAffinity": "0",
    "governor": "unavailable",
    "cc": "gcc-13 (Debian 13.3.0-16) 13.3.0",
    "clang": "Debian clang version 18.1.8 (++20240731024826+3b5b5c1ec4a3-1~exp1~20240731144843.145)",
    "lld": "Debian LLD 18.1.8 (compatible with GNU linkers)",
    "node": "v24.19.0",
    "note": "Development cloud measurement on Debian 13, not the Ubuntu 24.04 reference machine. GCC 13.3, clang 18.1.8 and lld 18.1.8 pinned from official vendor packages. Entire benchmark and descendants pinned to CPU 0. Remote source revision 6839d353899001b0ce966c0b5e3b54cf40051352 was verified against all 396 local tracked file blobs; local HEAD differs only by the subsequently recorded self-host proof document. Upstream base d668d8e18cb70087ae88799317cedd547c32b6d7. Fresh combined C and LLVM measurements; no prior baseline samples reused. No other assistant compile/test jobs during samples. Full conformance and LLVM self-host fixed-point proof passed before this run.",
    "deviations": [
      "reference CI OS is Ubuntu 24.04; this machine differs"
    ]
  },
  "options": {
    "runs": 10,
    "configs": [
      "c-O2",
      "c-O3",
      "c-lto",
      "llvm"
    ],
    "compiler": "build/asterc",
    "record": "llvm-decision",
    "sourceRevision": "6839d353899001b0ce966c0b5e3b54cf40051352",
    "environmentNote": "Development cloud measurement on Debian 13, not the Ubuntu 24.04 reference machine. GCC 13.3, clang 18.1.8 and lld 18.1.8 pinned from official vendor packages. Entire benchmark and descendants pinned to CPU 0. Remote source revision 6839d353899001b0ce966c0b5e3b54cf40051352 was verified against all 396 local tracked file blobs; local HEAD differs only by the subsequently recorded self-host proof document. Upstream base d668d8e18cb70087ae88799317cedd547c32b6d7. Fresh combined C and LLVM measurements; no prior baseline samples reused. No other assistant compile/test jobs during samples. Full conformance and LLVM self-host fixed-point proof passed before this run."
  },
  "workloadSources": [
    {
      "name": "array_sort",
      "sha256": "c8bdb38d9d0c50e5b6f0f842681387330cb5ca726c2898c8656c1d0f618e6138",
      "expected": {
        "stdout": "68652146336000035\n",
        "stderr": "",
        "exitCode": 0
      }
    },
    {
      "name": "calc_interpreter",
      "sha256": "29981cf4c3c1c6f40d23f45669dfb71084d5795c8e4434433a59ede8b978dfda",
      "expected": {
        "stdout": "74910056192\n",
        "stderr": "",
        "exitCode": 0
      }
    },
    {
      "name": "integer_loops",
      "sha256": "215a97b8cd5e67a77349c2212d89ba0c25fa1227e2ce31d84ad46b0d81abfcf7",
      "expected": {
        "stdout": "592666852\n",
        "stderr": "",
        "exitCode": 0
      }
    },
    {
      "name": "string_build",
      "sha256": "0240f307a0bcb4b429f616e0f885168547fffa88ec54fd9fc70d30d190cbf888",
      "expected": {
        "stdout": "584164027\n",
        "stderr": "",
        "exitCode": 0
      }
    },
    {
      "name": "struct_enum",
      "sha256": "51b3e8c444248f20d14cfc27c8cd1dd1b2b64653d95ae62f96caf851c59010e1",
      "expected": {
        "stdout": "667174078821\n",
        "stderr": "",
        "exitCode": 0
      }
    }
  ],
  "buildCommands": [
    {
      "configuration": "c-O2",
      "source": "bench/array_sort.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/array_sort.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/array_sort-c-O2"
      ]
    },
    {
      "configuration": "c-O2",
      "source": "bench/calc_interpreter.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/calc_interpreter.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/calc_interpreter-c-O2"
      ]
    },
    {
      "configuration": "c-O2",
      "source": "bench/integer_loops.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/integer_loops.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/integer_loops-c-O2"
      ]
    },
    {
      "configuration": "c-O2",
      "source": "bench/string_build.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/string_build.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/string_build-c-O2"
      ]
    },
    {
      "configuration": "c-O2",
      "source": "bench/struct_enum.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/struct_enum.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/struct_enum-c-O2"
      ]
    },
    {
      "configuration": "c-O2",
      "source": "packages/asterc-self/asterc.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "packages/asterc-self/asterc.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-O2"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/array_sort.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/array_sort.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/array_sort.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O3",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/array_sort-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/array_sort-c-O3"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/calc_interpreter.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/calc_interpreter.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/calc_interpreter.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O3",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/calc_interpreter-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/calc_interpreter-c-O3"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/integer_loops.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/integer_loops.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/integer_loops.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O3",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/integer_loops-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/integer_loops-c-O3"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/string_build.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/string_build.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/string_build.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O3",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/string_build-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/string_build-c-O3"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/struct_enum.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/struct_enum.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/struct_enum.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O3",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/struct_enum-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/struct_enum-c-O3"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "packages/asterc-self/asterc.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "packages/asterc-self/asterc.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "packages/asterc-self/asterc.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O3",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-O3"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/array_sort.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/array_sort.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/array_sort.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O2",
        "-flto",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/array_sort-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/array_sort-c-lto"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/calc_interpreter.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/calc_interpreter.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/calc_interpreter.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O2",
        "-flto",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/calc_interpreter-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/calc_interpreter-c-lto"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/integer_loops.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/integer_loops.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/integer_loops.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O2",
        "-flto",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/integer_loops-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/integer_loops-c-lto"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/string_build.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/string_build.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/string_build.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O2",
        "-flto",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/string_build-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/string_build-c-lto"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/struct_enum.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/struct_enum.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/struct_enum.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O2",
        "-flto",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/struct_enum-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/struct_enum-c-lto"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "packages/asterc-self/asterc.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "packages/asterc-self/asterc.aster",
        "--emit=c"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "packages/asterc-self/asterc.aster",
      "command": [
        "cc",
        "-std=c11",
        "-O2",
        "-flto",
        "-Wall",
        "-I/workspace/shared/aster-llvm-poc/packages/asterc/runtime",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-lto"
      ]
    },
    {
      "configuration": "llvm",
      "source": "bench/array_sort.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/array_sort.aster",
        "--backend=llvm",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/array_sort-llvm"
      ]
    },
    {
      "configuration": "llvm",
      "source": "bench/calc_interpreter.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/calc_interpreter.aster",
        "--backend=llvm",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/calc_interpreter-llvm"
      ]
    },
    {
      "configuration": "llvm",
      "source": "bench/integer_loops.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/integer_loops.aster",
        "--backend=llvm",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/integer_loops-llvm"
      ]
    },
    {
      "configuration": "llvm",
      "source": "bench/string_build.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/string_build.aster",
        "--backend=llvm",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/string_build-llvm"
      ]
    },
    {
      "configuration": "llvm",
      "source": "bench/struct_enum.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "bench/struct_enum.aster",
        "--backend=llvm",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/struct_enum-llvm"
      ]
    },
    {
      "configuration": "llvm",
      "source": "packages/asterc-self/asterc.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc",
        "build",
        "packages/asterc-self/asterc.aster",
        "--backend=llvm",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-llvm"
      ]
    }
  ],
  "results": [
    {
      "benchmark": "array_sort",
      "kind": "runtime",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/array_sort-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 238.538432,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 288.441713,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 225.553394,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 210.247857,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 257.636673,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 228.669134,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 209.931864,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 232.092552,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 222.01983,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 296.215431,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 210.121819,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 227.111264,
      "medianPeakRssKiB": 2688
    },
    {
      "benchmark": "array_sort",
      "kind": "runtime",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/array_sort-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 233.325224,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 305.35665,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 228.209292,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 211.50899,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 243.87305,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 256.151634,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 238.196077,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 260.748605,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 273.892574,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 244.550174,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 212.620074,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 244.211612,
      "medianPeakRssKiB": 2688
    },
    {
      "benchmark": "array_sort",
      "kind": "runtime",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/array_sort-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 107.645476,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 140.551911,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 131.648034,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 95.50009,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 109.18445,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 99.925575,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 116.809766,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 111.757248,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 97.912241,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 108.003831,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 94.9067,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 108.59414050000001,
      "medianPeakRssKiB": 2688
    },
    {
      "benchmark": "array_sort",
      "kind": "runtime",
      "configuration": "llvm",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/array_sort-llvm"
      ],
      "samples": [
        {
          "elapsedMs": 129.021479,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 145.342049,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 113.00157,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 104.30881,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 200.672909,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 269.691206,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 115.079428,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 199.135811,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 109.070049,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 113.417459,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 103.298483,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 114.2484435,
      "medianPeakRssKiB": 2688
    },
    {
      "benchmark": "calc_interpreter",
      "kind": "runtime",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/calc_interpreter-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 102.577185,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 249.753681,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 88.818769,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 153.502071,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 110.136469,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 81.310033,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 91.764871,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 98.421028,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 86.314169,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 86.617291,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 81.187092,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 90.29182,
      "medianPeakRssKiB": 74752
    },
    {
      "benchmark": "calc_interpreter",
      "kind": "runtime",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/calc_interpreter-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 120.632544,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 101.928505,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 88.167477,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 77.255587,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 77.255206,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 91.766498,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 78.892395,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 81.473188,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 82.527836,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 105.580427,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 71.54123,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 82.00051199999999,
      "medianPeakRssKiB": 74752
    },
    {
      "benchmark": "calc_interpreter",
      "kind": "runtime",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/calc_interpreter-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 108.737184,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 89.427572,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 92.151278,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 74.122795,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 68.877532,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 70.169151,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 109.428152,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 80.071321,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 89.203353,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 73.996989,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 69.396143,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 77.097058,
      "medianPeakRssKiB": 74752
    },
    {
      "benchmark": "calc_interpreter",
      "kind": "runtime",
      "configuration": "llvm",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/calc_interpreter-llvm"
      ],
      "samples": [
        {
          "elapsedMs": 77.297355,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 94.147131,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 79.90059,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 74.326462,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 86.353251,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 74.05953,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 105.334005,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 105.27293,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 85.841149,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 78.982032,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 75.588047,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 82.8708695,
      "medianPeakRssKiB": 74752
    },
    {
      "benchmark": "integer_loops",
      "kind": "runtime",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/integer_loops-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 159.062273,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 156.268789,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 159.423995,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 151.437503,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 162.940425,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 162.906797,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 172.414765,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 187.369755,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 163.945251,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 163.244784,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 155.955563,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 162.923611,
      "medianPeakRssKiB": 512
    },
    {
      "benchmark": "integer_loops",
      "kind": "runtime",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/integer_loops-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 159.385117,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 157.866897,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 160.748245,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 153.440932,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 165.24281,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 155.814341,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 183.769213,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 186.822403,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 166.059148,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 155.676076,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 159.216243,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 159.98224399999998,
      "medianPeakRssKiB": 512
    },
    {
      "benchmark": "integer_loops",
      "kind": "runtime",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/integer_loops-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 163.309036,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 161.625148,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 181.118965,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 158.880539,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 182.784981,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 158.779461,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 178.501833,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 198.624406,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 161.07718,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 163.034898,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 157.420225,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 162.33002299999998,
      "medianPeakRssKiB": 512
    },
    {
      "benchmark": "integer_loops",
      "kind": "runtime",
      "configuration": "llvm",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/integer_loops-llvm"
      ],
      "samples": [
        {
          "elapsedMs": 200.805104,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 191.894706,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 209.345452,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 186.297241,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 206.142698,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 197.910255,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 240.442781,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 231.682898,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 221.071946,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 213.893012,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 212.913022,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 211.129237,
      "medianPeakRssKiB": 512
    },
    {
      "benchmark": "string_build",
      "kind": "runtime",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/string_build-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 151.114957,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 174.49655,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 293.126921,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 159.737259,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 148.838108,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 331.704446,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 158.334202,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 194.012593,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 178.006874,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 156.154058,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 129.36412,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 167.1169045,
      "medianPeakRssKiB": 145024
    },
    {
      "benchmark": "string_build",
      "kind": "runtime",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/string_build-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 142.766689,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 161.015282,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 142.736182,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 164.386194,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 154.918794,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 168.407899,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 160.425293,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 147.562112,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 149.708875,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 166.269331,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 128.494412,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 157.6720435,
      "medianPeakRssKiB": 145024
    },
    {
      "benchmark": "string_build",
      "kind": "runtime",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/string_build-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 132.991131,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 151.731198,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 140.620607,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 148.389463,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 140.210518,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 182.610085,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 251.087969,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 141.531361,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 159.049948,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 163.168319,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 164.147491,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 155.39057300000002,
      "medianPeakRssKiB": 145024
    },
    {
      "benchmark": "string_build",
      "kind": "runtime",
      "configuration": "llvm",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/string_build-llvm"
      ],
      "samples": [
        {
          "elapsedMs": 131.530348,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 146.263863,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 148.190388,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 137.302435,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 136.068871,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 167.281418,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 173.546443,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 359.627682,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 145.466884,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 153.334631,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 137.347355,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 147.2271255,
      "medianPeakRssKiB": 145024
    },
    {
      "benchmark": "struct_enum",
      "kind": "runtime",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/struct_enum-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 115.544689,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 136.272733,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 121.558437,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 135.628361,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 120.187294,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 127.922667,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 117.29238,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 123.014873,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 135.817908,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 142.569593,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 127.319156,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 127.6209115,
      "medianPeakRssKiB": 125696
    },
    {
      "benchmark": "struct_enum",
      "kind": "runtime",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/struct_enum-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 116.672462,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 138.767397,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 130.260183,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 140.536944,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 117.99264,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 138.071921,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 119.649537,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 117.933293,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 130.845901,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 128.306761,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 141.229317,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 130.553042,
      "medianPeakRssKiB": 125696
    },
    {
      "benchmark": "struct_enum",
      "kind": "runtime",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/struct_enum-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 112.677547,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 129.229487,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 114.347566,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 121.152179,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 200.756464,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 122.678756,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 121.872778,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 111.017526,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 129.662157,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 217.123679,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 106.52868,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 122.275767,
      "medianPeakRssKiB": 125696
    },
    {
      "benchmark": "struct_enum",
      "kind": "runtime",
      "configuration": "llvm",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/struct_enum-llvm"
      ],
      "samples": [
        {
          "elapsedMs": 72.614347,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 75.410777,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 75.989612,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 76.328192,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 67.334691,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 73.144087,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 73.198255,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 68.537951,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 81.222142,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 70.959372,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 65.384521,
          "peakRssKiB": 63232,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 73.171171,
      "medianPeakRssKiB": 63232
    },
    {
      "benchmark": "self-emit-c",
      "kind": "self-emit-c",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-O2",
        "build",
        "packages/asterc-self/asterc.aster",
        "--emit=c"
      ],
      "samples": [
        {
          "elapsedMs": 230.085313,
          "peakRssKiB": 246832,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 168.179859,
          "peakRssKiB": 246832,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 173.944029,
          "peakRssKiB": 246820,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 178.19929,
          "peakRssKiB": 246820,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 160.407229,
          "peakRssKiB": 246816,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 165.863114,
          "peakRssKiB": 246812,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 186.515946,
          "peakRssKiB": 246820,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 193.473086,
          "peakRssKiB": 246816,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 172.912677,
          "peakRssKiB": 246804,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 155.176438,
          "peakRssKiB": 246820,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 179.506109,
          "peakRssKiB": 246828,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 173.42835300000002,
      "medianPeakRssKiB": 246820
    },
    {
      "benchmark": "self-emit-c",
      "kind": "self-emit-c",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-O3",
        "build",
        "packages/asterc-self/asterc.aster",
        "--emit=c"
      ],
      "samples": [
        {
          "elapsedMs": 176.842615,
          "peakRssKiB": 246816,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 351.06878,
          "peakRssKiB": 246808,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 158.499524,
          "peakRssKiB": 246808,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 189.324687,
          "peakRssKiB": 246808,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 155.565727,
          "peakRssKiB": 246832,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 184.682127,
          "peakRssKiB": 246808,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 176.830959,
          "peakRssKiB": 246832,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 183.044037,
          "peakRssKiB": 246832,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 155.799939,
          "peakRssKiB": 246808,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 195.161564,
          "peakRssKiB": 246832,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 322.83598,
          "peakRssKiB": 246824,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 183.86308200000002,
      "medianPeakRssKiB": 246816
    },
    {
      "benchmark": "self-emit-c",
      "kind": "self-emit-c",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-lto",
        "build",
        "packages/asterc-self/asterc.aster",
        "--emit=c"
      ],
      "samples": [
        {
          "elapsedMs": 149.066214,
          "peakRssKiB": 246824,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 200.428007,
          "peakRssKiB": 246700,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 191.710133,
          "peakRssKiB": 246704,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 167.822683,
          "peakRssKiB": 246800,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 193.089951,
          "peakRssKiB": 246800,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 182.810447,
          "peakRssKiB": 246824,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 162.844887,
          "peakRssKiB": 246804,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 162.945078,
          "peakRssKiB": 246712,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 149.415318,
          "peakRssKiB": 246700,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 155.970398,
          "peakRssKiB": 246816,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 167.924917,
          "peakRssKiB": 246704,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 167.87380000000002,
      "medianPeakRssKiB": 246756
    },
    {
      "benchmark": "self-emit-c",
      "kind": "self-emit-c",
      "configuration": "llvm",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-llvm",
        "build",
        "packages/asterc-self/asterc.aster",
        "--emit=c"
      ],
      "samples": [
        {
          "elapsedMs": 124.679277,
          "peakRssKiB": 245268,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 170.2427,
          "peakRssKiB": 245276,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 150.071041,
          "peakRssKiB": 245288,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 378.413625,
          "peakRssKiB": 245260,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 141.382108,
          "peakRssKiB": 245288,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 168.693053,
          "peakRssKiB": 245304,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 318.293944,
          "peakRssKiB": 245304,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 160.870714,
          "peakRssKiB": 245284,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 140.119563,
          "peakRssKiB": 245272,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 148.087151,
          "peakRssKiB": 245304,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 155.260579,
          "peakRssKiB": 245280,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "7420fa5818e521e4620f1f47c15093db494b73b6d2c88db464d126f7739d2993",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 158.0656465,
      "medianPeakRssKiB": 245286
    },
    {
      "benchmark": "self-build",
      "kind": "self-build",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-O2",
        "build",
        "packages/asterc-self/asterc.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/rebuilt-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 4453.96571,
          "peakRssKiB": 247984,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4293.178457,
          "peakRssKiB": 247972,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4516.314813,
          "peakRssKiB": 247984,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4289.088544,
          "peakRssKiB": 247972,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4589.377811,
          "peakRssKiB": 247972,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4818.863997,
          "peakRssKiB": 247984,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4349.171582,
          "peakRssKiB": 247972,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4437.21055,
          "peakRssKiB": 247972,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4709.316818,
          "peakRssKiB": 247980,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4668.151084,
          "peakRssKiB": 247964,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4446.311954,
          "peakRssKiB": 247984,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 4481.3133835,
      "medianPeakRssKiB": 247972
    },
    {
      "benchmark": "self-build",
      "kind": "self-build",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-O3",
        "build",
        "packages/asterc-self/asterc.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/rebuilt-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 4682.633966,
          "peakRssKiB": 248088,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4532.764502,
          "peakRssKiB": 248088,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4465.884854,
          "peakRssKiB": 248088,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4226.920082,
          "peakRssKiB": 248088,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 5166.627244,
          "peakRssKiB": 248088,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4701.467805,
          "peakRssKiB": 248088,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 5296.597704,
          "peakRssKiB": 247984,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4884.874543,
          "peakRssKiB": 247968,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4405.072666,
          "peakRssKiB": 248088,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4531.532622,
          "peakRssKiB": 247984,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4819.18726,
          "peakRssKiB": 248088,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 4617.1161535,
      "medianPeakRssKiB": 248088
    },
    {
      "benchmark": "self-build",
      "kind": "self-build",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-c-lto",
        "build",
        "packages/asterc-self/asterc.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/rebuilt-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 4552.553301,
          "peakRssKiB": 247960,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4859.607165,
          "peakRssKiB": 247968,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4340.437204,
          "peakRssKiB": 247988,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4415.200211,
          "peakRssKiB": 247984,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4628.089855,
          "peakRssKiB": 247968,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4573.419623,
          "peakRssKiB": 247960,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4373.472303,
          "peakRssKiB": 247984,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4663.462608,
          "peakRssKiB": 247956,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4391.725577,
          "peakRssKiB": 247984,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4606.263252,
          "peakRssKiB": 247980,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4568.015685,
          "peakRssKiB": 247952,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 4570.717654,
      "medianPeakRssKiB": 247974
    },
    {
      "benchmark": "self-build",
      "kind": "self-build",
      "configuration": "llvm",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/self-llvm",
        "build",
        "packages/asterc-self/asterc.aster",
        "--backend=llvm",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-3rZS9H/rebuilt-llvm"
      ],
      "samples": [
        {
          "elapsedMs": 6225.585485,
          "peakRssKiB": 465684,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 5264.548338,
          "peakRssKiB": 465684,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 5075.6602,
          "peakRssKiB": 465596,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4931.026682,
          "peakRssKiB": 465688,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 5134.71915,
          "peakRssKiB": 465592,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4684.853213,
          "peakRssKiB": 465592,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 5001.242724,
          "peakRssKiB": 465592,
          "exitCode": 0,
          "signal": 0,
          "round": 6,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 5006.804714,
          "peakRssKiB": 465592,
          "exitCode": 0,
          "signal": 0,
          "round": 7,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4769.910487,
          "peakRssKiB": 465684,
          "exitCode": 0,
          "signal": 0,
          "round": 8,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4618.57009,
          "peakRssKiB": 465676,
          "exitCode": 0,
          "signal": 0,
          "round": 9,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4737.615607,
          "peakRssKiB": 465588,
          "exitCode": 0,
          "signal": 0,
          "round": 10,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 4966.134703,
      "medianPeakRssKiB": 465594
    }
  ],
  "bestC": "c-lto",
  "geometricMeanSpeedups": {
    "c-O2": 1,
    "c-O3": 1.015601647152832,
    "c-lto": 1.225070393295912,
    "llvm": 1.2703897641139237
  },
  "decision": {
    "status": "inconclusive",
    "reason": "Measured gates are shown, but sample quality requires a fresh, quieter combined run before a performance conclusion.",
    "bestC": "c-lto",
    "suiteSpeedup": 1.0369932789707579,
    "suitePass": false,
    "selfBuildSpeedup": 0.920377300929608,
    "selfBuildPass": false,
    "runtimePass": false,
    "measuredGatesPass": false,
    "workloads": [
      {
        "benchmark": "array_sort",
        "llvmVsBestCSpeedup": 0.9505087086810072,
        "regression": 0.052068214490817555,
        "pass": false,
        "fastestC": "c-lto",
        "llvmVsFastestCSpeedup": 0.9505087086810072
      },
      {
        "benchmark": "calc_interpreter",
        "llvmVsBestCSpeedup": 0.9303276104759587,
        "regression": 0.07489016636665946,
        "pass": false,
        "fastestC": "c-lto",
        "llvmVsFastestCSpeedup": 0.9303276104759587
      },
      {
        "benchmark": "integer_loops",
        "llvmVsBestCSpeedup": 0.7688656734926769,
        "regression": 0.3006173047853262,
        "pass": false,
        "fastestC": "c-O3",
        "llvmVsFastestCSpeedup": 0.7577455698378713
      },
      {
        "benchmark": "string_build",
        "llvmVsBestCSpeedup": 1.0554479853646264,
        "regression": -0.05253502411629574,
        "pass": true,
        "fastestC": "c-lto",
        "llvmVsFastestCSpeedup": 1.0554479853646264
      },
      {
        "benchmark": "struct_enum",
        "llvmVsBestCSpeedup": 1.6710921163199643,
        "regression": -0.4015889428033602,
        "pass": true,
        "fastestC": "c-lto",
        "llvmVsFastestCSpeedup": 1.6710921163199643
      }
    ],
    "variability": [
      {
        "benchmark": "array_sort",
        "configuration": "c-O2",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 209.931864,
        "maxMs": 296.215431,
        "relativeSpread": 0.3799176028539035,
        "noisy": true
      },
      {
        "benchmark": "array_sort",
        "configuration": "c-O3",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 211.50899,
        "maxMs": 305.35665,
        "relativeSpread": 0.3842882786425405,
        "noisy": true
      },
      {
        "benchmark": "array_sort",
        "configuration": "c-lto",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 94.9067,
        "maxMs": 140.551911,
        "relativeSpread": 0.4203284890863885,
        "noisy": true
      },
      {
        "benchmark": "array_sort",
        "configuration": "llvm",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 103.298483,
        "maxMs": 269.691206,
        "relativeSpread": 1.4564112901897,
        "noisy": true
      },
      {
        "benchmark": "calc_interpreter",
        "configuration": "c-O2",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 81.187092,
        "maxMs": 249.753681,
        "relativeSpread": 1.8669087520885057,
        "noisy": true
      },
      {
        "benchmark": "calc_interpreter",
        "configuration": "c-O3",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 71.54123,
        "maxMs": 105.580427,
        "relativeSpread": 0.4151095666329499,
        "noisy": true
      },
      {
        "benchmark": "calc_interpreter",
        "configuration": "c-lto",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 68.877532,
        "maxMs": 109.428152,
        "relativeSpread": 0.5259684487571497,
        "noisy": true
      },
      {
        "benchmark": "calc_interpreter",
        "configuration": "llvm",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 74.05953,
        "maxMs": 105.334005,
        "relativeSpread": 0.3773880398346733,
        "noisy": true
      },
      {
        "benchmark": "integer_loops",
        "configuration": "c-O2",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 151.437503,
        "maxMs": 187.369755,
        "relativeSpread": 0.2205466216925428,
        "noisy": true
      },
      {
        "benchmark": "integer_loops",
        "configuration": "c-O3",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 153.440932,
        "maxMs": 186.822403,
        "relativeSpread": 0.20865734949936074,
        "noisy": true
      },
      {
        "benchmark": "integer_loops",
        "configuration": "c-lto",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 157.420225,
        "maxMs": 198.624406,
        "relativeSpread": 0.25382969975923686,
        "noisy": true
      },
      {
        "benchmark": "integer_loops",
        "configuration": "llvm",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 186.297241,
        "maxMs": 240.442781,
        "relativeSpread": 0.25645685443366606,
        "noisy": true
      },
      {
        "benchmark": "string_build",
        "configuration": "c-O2",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 129.36412,
        "maxMs": 331.704446,
        "relativeSpread": 1.21077114613501,
        "noisy": true
      },
      {
        "benchmark": "string_build",
        "configuration": "c-O3",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 128.494412,
        "maxMs": 168.407899,
        "relativeSpread": 0.2531424475385833,
        "noisy": true
      },
      {
        "benchmark": "string_build",
        "configuration": "c-lto",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 140.210518,
        "maxMs": 251.087969,
        "relativeSpread": 0.7135403960444883,
        "noisy": true
      },
      {
        "benchmark": "string_build",
        "configuration": "llvm",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 136.068871,
        "maxMs": 359.627682,
        "relativeSpread": 1.5184621056803829,
        "noisy": true
      },
      {
        "benchmark": "struct_enum",
        "configuration": "c-O2",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 117.29238,
        "maxMs": 142.569593,
        "relativeSpread": 0.19806482106186807,
        "noisy": false
      },
      {
        "benchmark": "struct_enum",
        "configuration": "c-O3",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 117.933293,
        "maxMs": 141.229317,
        "relativeSpread": 0.17844106612238114,
        "noisy": false
      },
      {
        "benchmark": "struct_enum",
        "configuration": "c-lto",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 106.52868,
        "maxMs": 217.123679,
        "relativeSpread": 0.9044719302394563,
        "noisy": true
      },
      {
        "benchmark": "struct_enum",
        "configuration": "llvm",
        "kind": "runtime",
        "timedRuns": 10,
        "minMs": 65.384521,
        "maxMs": 81.222142,
        "relativeSpread": 0.21644618752923878,
        "noisy": true
      },
      {
        "benchmark": "self-emit-c",
        "configuration": "c-O2",
        "kind": "self-emit-c",
        "timedRuns": 10,
        "minMs": 155.176438,
        "maxMs": 193.473086,
        "relativeSpread": 0.22082114796996313,
        "noisy": true
      },
      {
        "benchmark": "self-emit-c",
        "configuration": "c-O3",
        "kind": "self-emit-c",
        "timedRuns": 10,
        "minMs": 155.565727,
        "maxMs": 351.06878,
        "relativeSpread": 1.06330782054442,
        "noisy": true
      },
      {
        "benchmark": "self-emit-c",
        "configuration": "c-lto",
        "kind": "self-emit-c",
        "timedRuns": 10,
        "minMs": 149.415318,
        "maxMs": 200.428007,
        "relativeSpread": 0.3038752265094374,
        "noisy": true
      },
      {
        "benchmark": "self-emit-c",
        "configuration": "llvm",
        "kind": "self-emit-c",
        "timedRuns": 10,
        "minMs": 140.119563,
        "maxMs": 378.413625,
        "relativeSpread": 1.5075638968774914,
        "noisy": true
      },
      {
        "benchmark": "self-build",
        "configuration": "c-O2",
        "kind": "self-build",
        "timedRuns": 10,
        "minMs": 4289.088544,
        "maxMs": 4818.863997,
        "relativeSpread": 0.11821879160484743,
        "noisy": false
      },
      {
        "benchmark": "self-build",
        "configuration": "c-O3",
        "kind": "self-build",
        "timedRuns": 10,
        "minMs": 4226.920082,
        "maxMs": 5296.597704,
        "relativeSpread": 0.23167656745848425,
        "noisy": true
      },
      {
        "benchmark": "self-build",
        "configuration": "c-lto",
        "kind": "self-build",
        "timedRuns": 10,
        "minMs": 4340.437204,
        "maxMs": 4859.607165,
        "relativeSpread": 0.11358609310414441,
        "noisy": false
      },
      {
        "benchmark": "self-build",
        "configuration": "llvm",
        "kind": "self-build",
        "timedRuns": 10,
        "minMs": 4618.57009,
        "maxMs": 5264.548338,
        "relativeSpread": 0.13007666658936365,
        "noisy": false
      }
    ],
    "qualityIssues": [
      "array_sort/c-O2: (max-min)/median is 38.0%, above 20%",
      "array_sort/c-O3: (max-min)/median is 38.4%, above 20%",
      "array_sort/c-lto: (max-min)/median is 42.0%, above 20%",
      "array_sort/llvm: (max-min)/median is 145.6%, above 20%",
      "calc_interpreter/c-O2: (max-min)/median is 186.7%, above 20%",
      "calc_interpreter/c-O3: (max-min)/median is 41.5%, above 20%",
      "calc_interpreter/c-lto: (max-min)/median is 52.6%, above 20%",
      "calc_interpreter/llvm: (max-min)/median is 37.7%, above 20%",
      "integer_loops/c-O2: (max-min)/median is 22.1%, above 20%",
      "integer_loops/c-O3: (max-min)/median is 20.9%, above 20%",
      "integer_loops/c-lto: (max-min)/median is 25.4%, above 20%",
      "integer_loops/llvm: (max-min)/median is 25.6%, above 20%",
      "string_build/c-O2: (max-min)/median is 121.1%, above 20%",
      "string_build/c-O3: (max-min)/median is 25.3%, above 20%",
      "string_build/c-lto: (max-min)/median is 71.4%, above 20%",
      "string_build/llvm: (max-min)/median is 151.8%, above 20%",
      "struct_enum/c-lto: (max-min)/median is 90.4%, above 20%",
      "struct_enum/llvm: (max-min)/median is 21.6%, above 20%"
    ]
  },
  "ok": true,
  "failure": null
}
```
