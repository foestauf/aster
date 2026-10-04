# Aster C / LLVM benchmark record

This is a measurement of the machine and inputs named below. Deviations are explicit; it is not automatically a certified reference-machine result.

```text
Aster benchmark report
recorded    2026-10-04T22:03:43.893Z
git commit  73ab1bc0d2461a0684d307a85e1575f79e040acc (dirty: yes)
source rev  d668d8e18cb70087ae88799317cedd547c32b6d7
input hash  9b061f9f5f62e8d02ecf1651801c8001bdd7ca8e8967dfdf15f8b92ab419ef3a
compiler    4753502a67c935dee4752f70b79826117a5a6523a25872d378cee34a6ad90ed2
platform    Linux x86_64; Debian GNU/Linux 13 (trixie)
CPU         AMD EPYC 9V74 80-Core Processor (9 visible logical CPUs); governor: unavailable
cc          gcc-13 (Debian 13.3.0-16) 13.3.0
clang       Debian clang version 18.1.8 (++20240731024826+3b5b5c1ec4a3-1~exp1~20240731144843.145)
lld         Debian LLD 18.1.8 (compatible with GNU linkers)
node        v24.19.0
note        Development cloud baseline on Debian 13, not the Ubuntu 24.04 reference machine. Sources materialized from authenticated upstream Git blobs at the stated source revision; local git HEAD is a synthetic snapshot. Pinned official GCC 13.3 and clang/lld 18.1.8 extracted locally. No other assistant compile/test jobs run during samples.
DEVIATION   reference CI OS is Ubuntu 24.04; this machine differs

Each case: 1 checked warmup + 5 checked timed runs; serial, rotating configuration order.
Wall time: CLOCK_MONOTONIC around fork/exec/wait. Peak RSS: Linux wait4 ru_maxrss (KiB).
RSS includes waited-for descendants, taking the largest individual process peak, not a simultaneous total.
Medians exclude warmups. Raw samples and all build commands are in .bench/report.json.

benchmark              configuration  median wall ms  median peak RSS KiB
array_sort             c-O2                  234.557                 2688
array_sort             c-O3                  237.097                 2688
array_sort             c-lto                 108.464                 2688
calc_interpreter       c-O2                   99.523                74752
calc_interpreter       c-O3                   87.683                74752
calc_interpreter       c-lto                  80.315                74752
integer_loops          c-O2                  170.025                  512
integer_loops          c-O3                  176.338                  512
integer_loops          c-lto                 178.367                  512
string_build           c-O2                  154.766               145024
string_build           c-O3                  149.218               145024
string_build           c-lto                 203.483               145024
struct_enum            c-O2                  128.089               125696
struct_enum            c-O3                  128.563               125696
struct_enum            c-lto                 127.977               125696
self-emit-c            c-O2                  141.222               237848
self-emit-c            c-O3                  162.714               237880
self-emit-c            c-lto                 187.833               237736
self-build             c-O2                 4217.781               238872
self-build             c-O3                 4461.788               238888
self-build             c-lto                3971.324               239008

Suite selection: geometric mean of the 5 runtime speedups over c-O2; self-compile rows excluded.
  c-O2: 1.0000x
  c-O3: 1.0227x
  c-lto: 1.1423x
Best measured whole-suite C configuration: c-lto.

self-emit-c: each configured compiler emits its own C; output must be byte-identical to the oracle.
self-build: each configured compiler completes a native rebuild; the rebuilt compiler must reproduce the C oracle.
C self-build uses the unchanged driver (cc -O2) for the child binary, even when the running compiler is c-O3/c-lto.
LLVM self-build selects --backend=llvm. Validation of rebuilt binaries is outside the measured interval.
No L5/default-backend decision follows from this run alone.

PASS
```

## Reproduce

Run `pnpm bootstrap`, then:

```sh
pnpm bench '--record' '--compiler=build/asterc-baseline' '--source-revision=d668d8e18cb70087ae88799317cedd547c32b6d7' '--environment-note=Development cloud baseline on Debian 13, not the Ubuntu 24.04 reference machine. Sources materialized from authenticated upstream Git blobs at the stated source revision; local git HEAD is a synthetic snapshot. Pinned official GCC 13.3 and clang/lld 18.1.8 extracted locally. No other assistant compile/test jobs run during samples.'
```

## Raw samples

### array_sort / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 270.805257 | 2688 | yes |
| 1 | no | 230.885199 | 2688 | yes |
| 2 | no | 234.556966 | 2688 | yes |
| 3 | no | 340.743838 | 2688 | yes |
| 4 | no | 253.738405 | 2688 | yes |
| 5 | no | 223.882034 | 2688 | yes |

### array_sort / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 322.328653 | 2560 | yes |
| 1 | no | 323.586376 | 2560 | yes |
| 2 | no | 217.723651 | 2688 | yes |
| 3 | no | 295.071899 | 2688 | yes |
| 4 | no | 218.284357 | 2688 | yes |
| 5 | no | 237.097377 | 2688 | yes |

### array_sort / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 146.504685 | 2688 | yes |
| 1 | no | 106.886730 | 2688 | yes |
| 2 | no | 108.464465 | 2688 | yes |
| 3 | no | 171.701690 | 2688 | yes |
| 4 | no | 115.701841 | 2688 | yes |
| 5 | no | 107.003219 | 2688 | yes |

### calc_interpreter / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 176.828934 | 74752 | yes |
| 1 | no | 83.901361 | 74752 | yes |
| 2 | no | 99.523407 | 74752 | yes |
| 3 | no | 112.319008 | 74752 | yes |
| 4 | no | 92.127685 | 74752 | yes |
| 5 | no | 108.921611 | 74752 | yes |

### calc_interpreter / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 155.297493 | 74752 | yes |
| 1 | no | 108.414855 | 74752 | yes |
| 2 | no | 82.203196 | 74752 | yes |
| 3 | no | 112.258603 | 74752 | yes |
| 4 | no | 80.057021 | 74752 | yes |
| 5 | no | 87.682940 | 74752 | yes |

### calc_interpreter / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 270.336932 | 74752 | yes |
| 1 | no | 101.090041 | 74752 | yes |
| 2 | no | 80.314929 | 74752 | yes |
| 3 | no | 72.880579 | 74752 | yes |
| 4 | no | 75.974208 | 74752 | yes |
| 5 | no | 84.825011 | 74752 | yes |

### integer_loops / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 191.523369 | 384 | yes |
| 1 | no | 163.996434 | 512 | yes |
| 2 | no | 164.203397 | 512 | yes |
| 3 | no | 170.024970 | 512 | yes |
| 4 | no | 171.335365 | 512 | yes |
| 5 | no | 179.428823 | 512 | yes |

### integer_loops / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 185.074303 | 512 | yes |
| 1 | no | 170.256119 | 512 | yes |
| 2 | no | 184.903402 | 512 | yes |
| 3 | no | 178.173512 | 512 | yes |
| 4 | no | 176.337675 | 512 | yes |
| 5 | no | 176.056346 | 512 | yes |

### integer_loops / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 196.758029 | 512 | yes |
| 1 | no | 189.447912 | 512 | yes |
| 2 | no | 166.855172 | 512 | yes |
| 3 | no | 178.366929 | 512 | yes |
| 4 | no | 185.023564 | 512 | yes |
| 5 | no | 171.548244 | 512 | yes |

### string_build / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 283.762621 | 145024 | yes |
| 1 | no | 156.522734 | 145024 | yes |
| 2 | no | 146.834453 | 145024 | yes |
| 3 | no | 154.766473 | 145024 | yes |
| 4 | no | 154.206487 | 145024 | yes |
| 5 | no | 179.513900 | 145024 | yes |

### string_build / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 244.855271 | 145024 | yes |
| 1 | no | 134.732938 | 145024 | yes |
| 2 | no | 149.218194 | 145024 | yes |
| 3 | no | 179.232383 | 145024 | yes |
| 4 | no | 156.385992 | 145024 | yes |
| 5 | no | 139.019416 | 145024 | yes |

### string_build / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 240.844380 | 145024 | yes |
| 1 | no | 149.214841 | 145024 | yes |
| 2 | no | 178.950092 | 145024 | yes |
| 3 | no | 211.409519 | 145024 | yes |
| 4 | no | 295.044250 | 144768 | yes |
| 5 | no | 203.483359 | 145024 | yes |

### struct_enum / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 235.236939 | 125696 | yes |
| 1 | no | 124.588641 | 125696 | yes |
| 2 | no | 137.726559 | 125696 | yes |
| 3 | no | 200.037879 | 125696 | yes |
| 4 | no | 128.089451 | 125696 | yes |
| 5 | no | 125.964655 | 125696 | yes |

### struct_enum / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 122.754057 | 125696 | yes |
| 1 | no | 128.562527 | 125696 | yes |
| 2 | no | 118.253217 | 125696 | yes |
| 3 | no | 250.235021 | 125696 | yes |
| 4 | no | 160.257868 | 125696 | yes |
| 5 | no | 122.637393 | 125696 | yes |

### struct_enum / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 117.357558 | 125696 | yes |
| 1 | no | 192.974211 | 125696 | yes |
| 2 | no | 106.189678 | 125696 | yes |
| 3 | no | 146.691805 | 125696 | yes |
| 4 | no | 127.976942 | 125696 | yes |
| 5 | no | 112.919968 | 125696 | yes |

### self-emit-c / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 431.608627 | 237848 | yes |
| 1 | no | 138.475387 | 237848 | yes |
| 2 | no | 167.660220 | 237848 | yes |
| 3 | no | 427.844677 | 237848 | yes |
| 4 | no | 141.221517 | 237848 | yes |
| 5 | no | 135.959406 | 237848 | yes |

### self-emit-c / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 160.782110 | 237848 | yes |
| 1 | no | 261.830478 | 237880 | yes |
| 2 | no | 159.112659 | 237880 | yes |
| 3 | no | 162.714318 | 237852 | yes |
| 4 | no | 183.283691 | 237848 | yes |
| 5 | no | 137.000506 | 237880 | yes |

### self-emit-c / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 134.152745 | 237744 | yes |
| 1 | no | 133.015109 | 237740 | yes |
| 2 | no | 217.237375 | 237736 | yes |
| 3 | no | 187.833456 | 237744 | yes |
| 4 | no | 170.165835 | 237736 | yes |
| 5 | no | 277.462938 | 237736 | yes |

### self-build / c-O2

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 4034.387504 | 238872 | yes |
| 1 | no | 3959.242389 | 239000 | yes |
| 2 | no | 3865.753880 | 238872 | yes |
| 3 | no | 4250.276683 | 238872 | yes |
| 4 | no | 4217.780592 | 238904 | yes |
| 5 | no | 4242.728467 | 238872 | yes |

### self-build / c-O3

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 4198.495804 | 238904 | yes |
| 1 | no | 3959.898261 | 238888 | yes |
| 2 | no | 4481.379868 | 239020 | yes |
| 3 | no | 4461.787662 | 238876 | yes |
| 4 | no | 4518.531797 | 238896 | yes |
| 5 | no | 4065.746619 | 238888 | yes |

### self-build / c-lto

| Round | Warmup | Wall ms | Peak RSS KiB | Checked |
|---:|:---:|---:|---:|:---:|
| 0 | yes | 3949.081327 | 239008 | yes |
| 1 | no | 3908.706245 | 239008 | yes |
| 2 | no | 3807.815106 | 239008 | yes |
| 3 | no | 4048.614576 | 239016 | yes |
| 4 | no | 4122.252335 | 238896 | yes |
| 5 | no | 3971.324181 | 239000 | yes |

## Exact run data

The JSON includes source checksums, expected output, compiler provenance, commands and all samples.

```json
{
  "schemaVersion": 1,
  "environment": {
    "recordedAt": "2026-10-04T22:03:43.893Z",
    "gitCommit": "73ab1bc0d2461a0684d307a85e1575f79e040acc",
    "gitDirty": true,
    "sourceRevision": "d668d8e18cb70087ae88799317cedd547c32b6d7",
    "inputSha256": "9b061f9f5f62e8d02ecf1651801c8001bdd7ca8e8967dfdf15f8b92ab419ef3a",
    "compilerSha256": "4753502a67c935dee4752f70b79826117a5a6523a25872d378cee34a6ad90ed2",
    "uname": "Linux x86_64",
    "osRelease": "Debian GNU/Linux 13 (trixie)",
    "cpu": "AMD EPYC 9V74 80-Core Processor",
    "cpuCount": 9,
    "governor": "unavailable",
    "cc": "gcc-13 (Debian 13.3.0-16) 13.3.0",
    "clang": "Debian clang version 18.1.8 (++20240731024826+3b5b5c1ec4a3-1~exp1~20240731144843.145)",
    "lld": "Debian LLD 18.1.8 (compatible with GNU linkers)",
    "node": "v24.19.0",
    "note": "Development cloud baseline on Debian 13, not the Ubuntu 24.04 reference machine. Sources materialized from authenticated upstream Git blobs at the stated source revision; local git HEAD is a synthetic snapshot. Pinned official GCC 13.3 and clang/lld 18.1.8 extracted locally. No other assistant compile/test jobs run during samples.",
    "deviations": [
      "reference CI OS is Ubuntu 24.04; this machine differs"
    ]
  },
  "options": {
    "runs": 5,
    "configs": [
      "c-O2",
      "c-O3",
      "c-lto"
    ],
    "compiler": "build/asterc-baseline",
    "record": "baseline",
    "sourceRevision": "d668d8e18cb70087ae88799317cedd547c32b6d7",
    "environmentNote": "Development cloud baseline on Debian 13, not the Ubuntu 24.04 reference machine. Sources materialized from authenticated upstream Git blobs at the stated source revision; local git HEAD is a synthetic snapshot. Pinned official GCC 13.3 and clang/lld 18.1.8 extracted locally. No other assistant compile/test jobs run during samples."
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
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
        "build",
        "bench/array_sort.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/array_sort-c-O2"
      ]
    },
    {
      "configuration": "c-O2",
      "source": "bench/calc_interpreter.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
        "build",
        "bench/calc_interpreter.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/calc_interpreter-c-O2"
      ]
    },
    {
      "configuration": "c-O2",
      "source": "bench/integer_loops.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
        "build",
        "bench/integer_loops.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/integer_loops-c-O2"
      ]
    },
    {
      "configuration": "c-O2",
      "source": "bench/string_build.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
        "build",
        "bench/string_build.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/string_build-c-O2"
      ]
    },
    {
      "configuration": "c-O2",
      "source": "bench/struct_enum.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
        "build",
        "bench/struct_enum.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/struct_enum-c-O2"
      ]
    },
    {
      "configuration": "c-O2",
      "source": "packages/asterc-self/asterc.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
        "build",
        "packages/asterc-self/asterc.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-O2"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/array_sort.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/array_sort-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/array_sort-c-O3"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/calc_interpreter.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/calc_interpreter-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/calc_interpreter-c-O3"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/integer_loops.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/integer_loops-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/integer_loops-c-O3"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/string_build.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/string_build-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/string_build-c-O3"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "bench/struct_enum.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/struct_enum-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/struct_enum-c-O3"
      ]
    },
    {
      "configuration": "c-O3",
      "source": "packages/asterc-self/asterc.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-O3.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-O3"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/array_sort.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/array_sort-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/array_sort-c-lto"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/calc_interpreter.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/calc_interpreter-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/calc_interpreter-c-lto"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/integer_loops.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/integer_loops-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/integer_loops-c-lto"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/string_build.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/string_build-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/string_build-c-lto"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "bench/struct_enum.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/struct_enum-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/struct_enum-c-lto"
      ]
    },
    {
      "configuration": "c-lto",
      "source": "packages/asterc-self/asterc.aster",
      "command": [
        "/workspace/shared/aster-llvm-poc/build/asterc-baseline",
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
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-lto.c",
        "/workspace/shared/aster-llvm-poc/packages/asterc/runtime/aster_rt.c",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-lto"
      ]
    }
  ],
  "results": [
    {
      "benchmark": "array_sort",
      "kind": "runtime",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/array_sort-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 270.805257,
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
          "elapsedMs": 230.885199,
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
          "elapsedMs": 234.556966,
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
          "elapsedMs": 340.743838,
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
          "elapsedMs": 253.738405,
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
          "elapsedMs": 223.882034,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 234.556966,
      "medianPeakRssKiB": 2688
    },
    {
      "benchmark": "array_sort",
      "kind": "runtime",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/array_sort-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 322.328653,
          "peakRssKiB": 2560,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 323.586376,
          "peakRssKiB": 2560,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 217.723651,
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
          "elapsedMs": 295.071899,
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
          "elapsedMs": 218.284357,
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
          "elapsedMs": 237.097377,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 237.097377,
      "medianPeakRssKiB": 2688
    },
    {
      "benchmark": "array_sort",
      "kind": "runtime",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/array_sort-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 146.504685,
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
          "elapsedMs": 106.88673,
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
          "elapsedMs": 108.464465,
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
          "elapsedMs": 171.70169,
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
          "elapsedMs": 115.701841,
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
          "elapsedMs": 107.003219,
          "peakRssKiB": 2688,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "b941ff83759987f46ba1f11f254a45c217cb34bc4610f1623270729f4c7bd6d0",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 108.464465,
      "medianPeakRssKiB": 2688
    },
    {
      "benchmark": "calc_interpreter",
      "kind": "runtime",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/calc_interpreter-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 176.828934,
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
          "elapsedMs": 83.901361,
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
          "elapsedMs": 99.523407,
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
          "elapsedMs": 112.319008,
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
          "elapsedMs": 92.127685,
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
          "elapsedMs": 108.921611,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 99.523407,
      "medianPeakRssKiB": 74752
    },
    {
      "benchmark": "calc_interpreter",
      "kind": "runtime",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/calc_interpreter-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 155.297493,
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
          "elapsedMs": 108.414855,
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
          "elapsedMs": 82.203196,
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
          "elapsedMs": 112.258603,
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
          "elapsedMs": 80.057021,
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
          "elapsedMs": 87.68294,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 87.68294,
      "medianPeakRssKiB": 74752
    },
    {
      "benchmark": "calc_interpreter",
      "kind": "runtime",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/calc_interpreter-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 270.336932,
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
          "elapsedMs": 101.090041,
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
          "elapsedMs": 80.314929,
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
          "elapsedMs": 72.880579,
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
          "elapsedMs": 75.974208,
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
          "elapsedMs": 84.825011,
          "peakRssKiB": 74752,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "7ab2ce60ee900d9e0fe224ec3bd708bc5373f77641c1259c254ba331fbc7b430",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 80.314929,
      "medianPeakRssKiB": 74752
    },
    {
      "benchmark": "integer_loops",
      "kind": "runtime",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/integer_loops-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 191.523369,
          "peakRssKiB": 384,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 163.996434,
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
          "elapsedMs": 164.203397,
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
          "elapsedMs": 170.02497,
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
          "elapsedMs": 171.335365,
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
          "elapsedMs": 179.428823,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 170.02497,
      "medianPeakRssKiB": 512
    },
    {
      "benchmark": "integer_loops",
      "kind": "runtime",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/integer_loops-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 185.074303,
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
          "elapsedMs": 170.256119,
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
          "elapsedMs": 184.903402,
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
          "elapsedMs": 178.173512,
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
          "elapsedMs": 176.337675,
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
          "elapsedMs": 176.056346,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 176.337675,
      "medianPeakRssKiB": 512
    },
    {
      "benchmark": "integer_loops",
      "kind": "runtime",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/integer_loops-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 196.758029,
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
          "elapsedMs": 189.447912,
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
          "elapsedMs": 166.855172,
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
          "elapsedMs": 178.366929,
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
          "elapsedMs": 185.023564,
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
          "elapsedMs": 171.548244,
          "peakRssKiB": 512,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "2859e146bd0c68596b17aa6e66cd72c380483dd9deb7cd65ec09a221ed049d02",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 178.366929,
      "medianPeakRssKiB": 512
    },
    {
      "benchmark": "string_build",
      "kind": "runtime",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/string_build-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 283.762621,
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
          "elapsedMs": 156.522734,
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
          "elapsedMs": 146.834453,
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
          "elapsedMs": 154.766473,
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
          "elapsedMs": 154.206487,
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
          "elapsedMs": 179.5139,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 154.766473,
      "medianPeakRssKiB": 145024
    },
    {
      "benchmark": "string_build",
      "kind": "runtime",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/string_build-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 244.855271,
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
          "elapsedMs": 134.732938,
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
          "elapsedMs": 149.218194,
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
          "elapsedMs": 179.232383,
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
          "elapsedMs": 156.385992,
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
          "elapsedMs": 139.019416,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 149.218194,
      "medianPeakRssKiB": 145024
    },
    {
      "benchmark": "string_build",
      "kind": "runtime",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/string_build-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 240.84438,
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
          "elapsedMs": 149.214841,
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
          "elapsedMs": 178.950092,
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
          "elapsedMs": 211.409519,
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
          "elapsedMs": 295.04425,
          "peakRssKiB": 144768,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 203.483359,
          "peakRssKiB": 145024,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "c53fd8c3a9335bce5020e3a7dd2a81c7f698187913fe69e853ceb813a135a47f",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 203.483359,
      "medianPeakRssKiB": 145024
    },
    {
      "benchmark": "struct_enum",
      "kind": "runtime",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/struct_enum-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 235.236939,
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
          "elapsedMs": 124.588641,
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
          "elapsedMs": 137.726559,
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
          "elapsedMs": 200.037879,
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
          "elapsedMs": 128.089451,
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
          "elapsedMs": 125.964655,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 128.089451,
      "medianPeakRssKiB": 125696
    },
    {
      "benchmark": "struct_enum",
      "kind": "runtime",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/struct_enum-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 122.754057,
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
          "elapsedMs": 128.562527,
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
          "elapsedMs": 118.253217,
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
          "elapsedMs": 250.235021,
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
          "elapsedMs": 160.257868,
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
          "elapsedMs": 122.637393,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 128.562527,
      "medianPeakRssKiB": 125696
    },
    {
      "benchmark": "struct_enum",
      "kind": "runtime",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/struct_enum-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 117.357558,
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
          "elapsedMs": 192.974211,
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
          "elapsedMs": 106.189678,
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
          "elapsedMs": 146.691805,
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
          "elapsedMs": 127.976942,
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
          "elapsedMs": 112.919968,
          "peakRssKiB": 125696,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "f2e652261fc51dda47dd00fe815881e0f846b65e50a80a01c17526eded57a1fa",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 127.976942,
      "medianPeakRssKiB": 125696
    },
    {
      "benchmark": "self-emit-c",
      "kind": "self-emit-c",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-O2",
        "build",
        "packages/asterc-self/asterc.aster",
        "--emit=c"
      ],
      "samples": [
        {
          "elapsedMs": 431.608627,
          "peakRssKiB": 237848,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 138.475387,
          "peakRssKiB": 237848,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 167.66022,
          "peakRssKiB": 237848,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 427.844677,
          "peakRssKiB": 237848,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 141.221517,
          "peakRssKiB": 237848,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 135.959406,
          "peakRssKiB": 237848,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 141.221517,
      "medianPeakRssKiB": 237848
    },
    {
      "benchmark": "self-emit-c",
      "kind": "self-emit-c",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-O3",
        "build",
        "packages/asterc-self/asterc.aster",
        "--emit=c"
      ],
      "samples": [
        {
          "elapsedMs": 160.78211,
          "peakRssKiB": 237848,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 261.830478,
          "peakRssKiB": 237880,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 159.112659,
          "peakRssKiB": 237880,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 162.714318,
          "peakRssKiB": 237852,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 183.283691,
          "peakRssKiB": 237848,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 137.000506,
          "peakRssKiB": 237880,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 162.714318,
      "medianPeakRssKiB": 237880
    },
    {
      "benchmark": "self-emit-c",
      "kind": "self-emit-c",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-lto",
        "build",
        "packages/asterc-self/asterc.aster",
        "--emit=c"
      ],
      "samples": [
        {
          "elapsedMs": 134.152745,
          "peakRssKiB": 237744,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 133.015109,
          "peakRssKiB": 237740,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 217.237375,
          "peakRssKiB": 237736,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 187.833456,
          "peakRssKiB": 237744,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 170.165835,
          "peakRssKiB": 237736,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 277.462938,
          "peakRssKiB": 237736,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "0325060af2fc40645a7abefadfdb245aa6f556dd6f772192c68ca41fedc8e9a1",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 187.833456,
      "medianPeakRssKiB": 237736
    },
    {
      "benchmark": "self-build",
      "kind": "self-build",
      "configuration": "c-O2",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-O2",
        "build",
        "packages/asterc-self/asterc.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/rebuilt-c-O2"
      ],
      "samples": [
        {
          "elapsedMs": 4034.387504,
          "peakRssKiB": 238872,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 3959.242389,
          "peakRssKiB": 239000,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 3865.75388,
          "peakRssKiB": 238872,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4250.276683,
          "peakRssKiB": 238872,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4217.780592,
          "peakRssKiB": 238904,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4242.728467,
          "peakRssKiB": 238872,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 4217.780592,
      "medianPeakRssKiB": 238872
    },
    {
      "benchmark": "self-build",
      "kind": "self-build",
      "configuration": "c-O3",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-O3",
        "build",
        "packages/asterc-self/asterc.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/rebuilt-c-O3"
      ],
      "samples": [
        {
          "elapsedMs": 4198.495804,
          "peakRssKiB": 238904,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 3959.898261,
          "peakRssKiB": 238888,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4481.379868,
          "peakRssKiB": 239020,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4461.787662,
          "peakRssKiB": 238876,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4518.531797,
          "peakRssKiB": 238896,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4065.746619,
          "peakRssKiB": 238888,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 4461.787662,
      "medianPeakRssKiB": 238888
    },
    {
      "benchmark": "self-build",
      "kind": "self-build",
      "configuration": "c-lto",
      "command": [
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/self-c-lto",
        "build",
        "packages/asterc-self/asterc.aster",
        "-o",
        "/workspace/shared/aster-llvm-poc/.bench/work-aU2NeW/rebuilt-c-lto"
      ],
      "samples": [
        {
          "elapsedMs": 3949.081327,
          "peakRssKiB": 239008,
          "exitCode": 0,
          "signal": 0,
          "round": 0,
          "warmup": true,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 3908.706245,
          "peakRssKiB": 239008,
          "exitCode": 0,
          "signal": 0,
          "round": 1,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 3807.815106,
          "peakRssKiB": 239008,
          "exitCode": 0,
          "signal": 0,
          "round": 2,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4048.614576,
          "peakRssKiB": 239016,
          "exitCode": 0,
          "signal": 0,
          "round": 3,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 4122.252335,
          "peakRssKiB": 238896,
          "exitCode": 0,
          "signal": 0,
          "round": 4,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        },
        {
          "elapsedMs": 3971.324181,
          "peakRssKiB": 239000,
          "exitCode": 0,
          "signal": 0,
          "round": 5,
          "warmup": false,
          "stdoutSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "stderrSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "valid": true
        }
      ],
      "medianWallMs": 3971.324181,
      "medianPeakRssKiB": 239008
    }
  ],
  "bestC": "c-lto",
  "geometricMeanSpeedups": {
    "c-O2": 1,
    "c-O3": 1.0227057008824647,
    "c-lto": 1.1422562983235838
  },
  "ok": true,
  "failure": null
}
```
