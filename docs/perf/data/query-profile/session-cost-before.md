# Compiler session cost record (#62)

A measurement of the machine and inputs named below, made by `node scripts/session-cost.ts --record`. Raw samples are in
[`data/session-cost.json`](data/session-cost.json). These are not editor end-to-end latencies: VS Code's own scheduling is
not included.

```text
recorded        2026-10-11T02:38:39.126Z
gitCommit       67dac81650270f04b463fd4df2e4c9905adf8d19
gitDirty        true
compilerSha256  430bf4d9b5f6b15cf46d93c5be515cf8704b66fea07874feee6c33b5a7751dc6
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
| launch (1 line) | check | 2.3 (2.1–2.5) | 1920 (1792–1920) | 117 | 0 |
| launch (1 line) | inspect | 2.6 (2.5–2.9) | 2304 (2176–2304) | 5803 | 0 |
| launch (1 line) | query | 4.2 (4.1–4.3) | 3328 (3200–3328) | 6188 | 0 |
| demo (2 files) | check | 2.4 (2.1–2.7) | 1920 (1920–1920) | 162 | 0 |
| demo (2 files) | inspect | 2.8 (2.7–3.0) | 2432 (2304–2432) | 8050 | 0 |
| demo (2 files) | query | 4.5 (4.2–4.8) | 3584 (3456–3584) | 8488 | 0 |
| compiler (18 files) | check | 188.8 (186.1–194.5) | 297192 (297004–297200) | 887 | 0 |
| compiler (18 files) | inspect | 291.0 (279.7–309.7) | 412646 (412520–412652) | 1742441 | 0 |
| compiler (18 files) | query | 415.7 (406.9–473.1) | 417896 (417888–417900) | 1743908 | 0 |
| generated (467 KiB) | check | 128.5 (126.2–157.4) | 105468 (105336–105472) | 118 | 0 |
| generated (467 KiB) | inspect | 595.4 (575.4–661.2) | 650408 (650160–650412) | 7877347 | 0 |
| generated (467 KiB) | query | 740.8 (729.8–767.2) | 673452 (673244–673456) | 7877522 | 0 |

Closure source bytes: launch (1 line) 29; demo (2 files) 410; compiler (18 files) 385081; generated (467 KiB) 477844.

First runs (nearest approximation of a cold run):

| Program | Command | First wall ms | First max RSS KiB |
| --- | --- | --- | --- |
| launch (1 line) | check | 3.7 | 1920 |
| launch (1 line) | inspect | 3.4 | 2304 |
| launch (1 line) | query | 4.3 | 3328 |
| demo (2 files) | check | 2.4 | 1920 |
| demo (2 files) | inspect | 2.8 | 2432 |
| demo (2 files) | query | 5.0 | 3584 |
| compiler (18 files) | check | 229.7 | 297200 |
| compiler (18 files) | inspect | 307.7 | 412476 |
| compiler (18 files) | query | 410.8 | 417904 |
| generated (467 KiB) | check | 124.8 | 105468 |
| generated (467 KiB) | inspect | 599.3 | 650408 |
| generated (467 KiB) | query | 789.7 | 673304 |

## Adapter side (in process, compiler-closure query response)

Response: 1743908 bytes, 18 files.

| Step | ms median (min–max) |
| --- | --- |
| jsonParseMs | 6.656 (6.015–8.271) |
| readbackHashMs | 0.602 (0.352–2.976) |
| byteOffsetMs | 0.172 (0.170–1.100) |

## Adapter round trip (`Session.query`, sequential)

| Program | ms median (min–max) | Outcomes |
| --- | --- | --- |
| demo (2 files) | 4.7 (4.4–9.1) | answer |
| compiler (18 files) | 427.7 (415.1–435.1) | answer |

## Workloads (compiler closure unless named)

```json
{
  "hover sweep, sequential": {
    "requests": 20,
    "totalMs": 8529.240519000217,
    "peakProcesses": 1,
    "peakRssKiB": 417880,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 423.8803505001124,
      "min": 413.6231320002116,
      "max": 450.16882500005886
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, overlap": {
    "requests": 20,
    "totalMs": 1728.4926300002262,
    "peakProcesses": 20,
    "peakRssKiB": 4691628,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 1075.4453179999255,
      "min": 804.5623019998893,
      "max": 1200.2792910002172
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, cancel-previous": {
    "requests": 20,
    "totalMs": 1137.3478040001355,
    "peakProcesses": 2,
    "peakRssKiB": 412408,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 39.58881750004366,
      "min": 37.781208999920636,
      "max": 473.725019000005
    },
    "kinds": {
      "cancelled": 19,
      "answer": 1
    }
  },
  "rapid saves (5 checks, 30 ms apart)": {
    "totalMs": 346.543124999851,
    "peakProcesses": 2,
    "peakRssKiB": 295884,
    "leftover": 0,
    "perRequestMs": {
      "n": 5,
      "median": 38.438295000232756,
      "min": 37.78192799957469,
      "max": 209.7582490001805
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
      "ms": 4.075459999963641
    },
    "fixed": {
      "ok": true,
      "count": 0,
      "ms": 2.7463740003295243
    }
  },
  "query of a file outside the closure": {
    "outcome": "none: invalid position: file-not-in-closure",
    "ms": {
      "n": 5,
      "median": 426.57849099999294,
      "min": 417.218778999988,
      "max": 437.72788400016725
    }
  }
}
```
