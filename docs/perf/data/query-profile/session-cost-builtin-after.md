# Compiler session cost record (#62)

A measurement of the machine and inputs named below, made by `node scripts/session-cost.ts --record`. Raw samples are in
[`data/session-cost.json`](data/session-cost.json). These are not editor end-to-end latencies: VS Code's own scheduling is
not included.

```text
recorded        2026-10-11T03:07:49.299Z
gitCommit       cb7a170460671ba7fafe78b9858f5e99e12fc740
gitDirty        true
compilerSha256  9e7b56ebc37c3591562ab33b0e13938114c07be68300432e7fb32d9a97929196
platform        Linux 6.6.114.1-microsoft-standard-WSL2 x86_64
cpu             AMD Ryzen 7 5800X 8-Core Processor
logicalCpus     16
cc              cc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0
node            v24.4.0
cache           warm page cache; the first sample of each case is reported separately as the nearest approximation of cold
timing          wall: process.hrtime around spawnSync of /usr/bin/time; RSS: /usr/bin/time %M (KiB, the single process peak)
```

## Compiler processes

Each row: 10 timed runs after one separately recorded first run (`first` in the JSON). Medians exclude the first run.

| Program | Command | Wall ms median (min–max) | Max RSS KiB median (min–max) | Output bytes | Failed |
| --- | --- | --- | --- | --- | --- |
| launch (1 line) | check | 2.2 (2.1–2.5) | 1792 (1792–1920) | 117 | 0 |
| launch (1 line) | inspect | 2.5 (2.3–3.0) | 2176 (2048–2176) | 6006 | 0 |
| launch (1 line) | query | 2.4 (2.4–2.6) | 2176 (2048–2176) | 6391 | 0 |
| demo (2 files) | check | 2.4 (2.1–2.8) | 1920 (1920–1920) | 162 | 0 |
| demo (2 files) | inspect | 2.6 (2.5–2.7) | 2304 (2304–2304) | 8253 | 0 |
| demo (2 files) | query | 2.6 (2.4–2.8) | 2304 (2176–2304) | 8691 | 0 |
| compiler (18 files) | check | 67.7 (66.8–70.9) | 49458 (49248–49460) | 841 | 0 |
| compiler (18 files) | inspect | 125.4 (123.6–126.4) | 113264 (113088–113328) | 1697342 | 0 |
| compiler (18 files) | query | 132.6 (130.6–134.3) | 115760 (115600–115760) | 1698733 | 0 |
| generated (467 KiB) | check | 122.5 (119.8–135.0) | 100816 (100652–100820) | 118 | 0 |
| generated (467 KiB) | inspect | 393.2 (386.5–399.8) | 415376 (415228–415460) | 7877553 | 0 |
| generated (467 KiB) | query | 414.2 (407.9–426.8) | 429792 (429568–429796) | 7877728 | 0 |

Closure source bytes: launch (1 line) 29; demo (2 files) 410; compiler (18 files) 378189; generated (467 KiB) 477844.

First runs (nearest approximation of a cold run):

| Program | Command | First wall ms | First max RSS KiB |
| --- | --- | --- | --- |
| launch (1 line) | check | 3.5 | 1792 |
| launch (1 line) | inspect | 3.0 | 2176 |
| launch (1 line) | query | 2.4 | 2176 |
| demo (2 files) | check | 2.5 | 1920 |
| demo (2 files) | inspect | 2.5 | 2304 |
| demo (2 files) | query | 2.6 | 2304 |
| compiler (18 files) | check | 69.0 | 49244 |
| compiler (18 files) | inspect | 125.9 | 113200 |
| compiler (18 files) | query | 132.8 | 115556 |
| generated (467 KiB) | check | 122.2 | 100816 |
| generated (467 KiB) | inspect | 400.5 | 415452 |
| generated (467 KiB) | query | 410.2 | 429792 |

## Adapter side (in process, compiler-closure query response)

Response: 1698733 bytes, 17 files.

| Step | ms median (min–max) |
| --- | --- |
| jsonParseMs | 6.229 (5.774–11.562) |
| readbackHashMs | 0.590 (0.446–1.022) |
| byteOffsetMs | 0.168 (0.167–1.359) |

## Adapter round trip (`Session.query`, sequential)

| Program | ms median (min–max) | Outcomes |
| --- | --- | --- |
| demo (2 files) | 2.7 (2.4–8.5) | answer |
| compiler (18 files) | 141.2 (136.8–155.3) | answer |

## Workloads (compiler closure unless named)

```json
{
  "hover sweep, sequential": {
    "requests": 20,
    "totalMs": 2976.5594450002536,
    "peakProcesses": 1,
    "peakRssKiB": 115684,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 148.1059050001204,
      "min": 138.21681899949908,
      "max": 168.70352599956095
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, overlap": {
    "requests": 20,
    "totalMs": 823.3208039999008,
    "peakProcesses": 5,
    "peakRssKiB": 357352,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 169.61033849976957,
      "min": 152.98199799936265,
      "max": 196.28593300003558
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, cancel-previous": {
    "requests": 20,
    "totalMs": 805.6909929998219,
    "peakProcesses": 2,
    "peakRssKiB": 115604,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 38.273040999658406,
      "min": 36.474169000051916,
      "max": 155.64213200006634
    },
    "kinds": {
      "cancelled": 19,
      "answer": 1
    }
  },
  "rapid saves (5 checks, 30 ms apart)": {
    "totalMs": 230.83634799998254,
    "peakProcesses": 2,
    "peakRssKiB": 47704,
    "leftover": 0,
    "perRequestMs": {
      "n": 5,
      "median": 40.52792000025511,
      "min": 37.031711999326944,
      "max": 93.08558400068432
    },
    "kinds": {
      "superseded": 4,
      "diagnostics": 1
    }
  },
  "invalid → fixed (demo)": {
    "broken": {
      "ok": false,
      "count": 1,
      "ms": 4.184229000471532
    },
    "fixed": {
      "ok": true,
      "count": 0,
      "ms": 2.9636709997430444
    }
  },
  "query of a file outside the closure": {
    "outcome": "none: invalid position: file-not-in-closure",
    "ms": {
      "n": 5,
      "median": 142.42173899989575,
      "min": 139.23050899989903,
      "max": 148.40607299935073
    }
  }
}
```
