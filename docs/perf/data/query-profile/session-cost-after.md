# Compiler session cost record (#62)

A measurement of the machine and inputs named below, made by `node scripts/session-cost.ts --record`. Raw samples are in
[`data/session-cost.json`](data/session-cost.json). These are not editor end-to-end latencies: VS Code's own scheduling is
not included.

```text
recorded        2026-10-11T02:39:50.567Z
gitCommit       67dac81650270f04b463fd4df2e4c9905adf8d19
gitDirty        true
compilerSha256  97cd3a9464638bd1c873a1e58f6b6806a2a53217d9abebc1b96b4b354b77fddf
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
| launch (1 line) | check | 2.3 (2.2–2.4) | 1920 (1792–1920) | 117 | 0 |
| launch (1 line) | inspect | 2.6 (2.4–3.3) | 2176 (2176–2176) | 6006 | 0 |
| launch (1 line) | query | 4.3 (4.0–4.9) | 3136 (3072–3200) | 6391 | 0 |
| demo (2 files) | check | 2.7 (2.2–3.3) | 1920 (1920–1920) | 162 | 0 |
| demo (2 files) | inspect | 2.7 (2.5–3.0) | 2304 (2176–2304) | 8253 | 0 |
| demo (2 files) | query | 4.4 (4.2–4.7) | 3328 (3200–3328) | 8691 | 0 |
| compiler (18 files) | check | 69.3 (67.6–73.1) | 50746 (50664–50752) | 887 | 0 |
| compiler (18 files) | inspect | 129.8 (128.1–135.7) | 116412 (116168–116416) | 1742646 | 0 |
| compiler (18 files) | query | 255.1 (249.8–294.7) | 119864 (119628–119872) | 1744113 | 0 |
| generated (467 KiB) | check | 126.3 (121.4–134.7) | 100816 (100600–100820) | 118 | 0 |
| generated (467 KiB) | inspect | 392.7 (387.2–405.2) | 415452 (415296–415460) | 7877553 | 0 |
| generated (467 KiB) | query | 560.5 (552.5–580.4) | 430816 (430684–430820) | 7877728 | 0 |

Closure source bytes: launch (1 line) 29; demo (2 files) 410; compiler (18 files) 385081; generated (467 KiB) 477844.

First runs (nearest approximation of a cold run):

| Program | Command | First wall ms | First max RSS KiB |
| --- | --- | --- | --- |
| launch (1 line) | check | 3.4 | 1792 |
| launch (1 line) | inspect | 3.1 | 2176 |
| launch (1 line) | query | 4.1 | 3200 |
| demo (2 files) | check | 2.9 | 1920 |
| demo (2 files) | inspect | 2.6 | 2304 |
| demo (2 files) | query | 4.3 | 3328 |
| compiler (18 files) | check | 69.8 | 50748 |
| compiler (18 files) | inspect | 129.8 | 116284 |
| compiler (18 files) | query | 250.0 | 119660 |
| generated (467 KiB) | check | 123.2 | 100816 |
| generated (467 KiB) | inspect | 399.5 | 415452 |
| generated (467 KiB) | query | 562.9 | 430816 |

## Adapter side (in process, compiler-closure query response)

Response: 1744113 bytes, 18 files.

| Step | ms median (min–max) |
| --- | --- |
| jsonParseMs | 6.213 (5.936–9.478) |
| readbackHashMs | 0.606 (0.361–3.354) |
| byteOffsetMs | 0.172 (0.169–1.055) |

## Adapter round trip (`Session.query`, sequential)

| Program | ms median (min–max) | Outcomes |
| --- | --- | --- |
| demo (2 files) | 4.6 (4.4–7.2) | answer |
| compiler (18 files) | 259.5 (254.4–273.6) | answer |

## Workloads (compiler closure unless named)

```json
{
  "hover sweep, sequential": {
    "requests": 20,
    "totalMs": 5519.345841000322,
    "peakProcesses": 1,
    "peakRssKiB": 119860,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 272.38709350000136,
      "min": 257.9459669999778,
      "max": 312.388195999898
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, overlap": {
    "requests": 20,
    "totalMs": 1098.3160149999894,
    "peakProcesses": 14,
    "peakRssKiB": 848124,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 442.8386995003093,
      "min": 394.72119399998337,
      "max": 532.4005069998093
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, cancel-previous": {
    "requests": 20,
    "totalMs": 976.0846430002712,
    "peakProcesses": 2,
    "peakRssKiB": 119768,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 40.06159649998881,
      "min": 38.71773999975994,
      "max": 304.8571359999478
    },
    "kinds": {
      "cancelled": 19,
      "answer": 1
    }
  },
  "rapid saves (5 checks, 30 ms apart)": {
    "totalMs": 209.6231859996915,
    "peakProcesses": 2,
    "peakRssKiB": 47964,
    "leftover": 0,
    "perRequestMs": {
      "n": 5,
      "median": 38.31337400013581,
      "min": 37.67979899980128,
      "max": 73.23585999989882
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
      "ms": 4.648463999852538
    },
    "fixed": {
      "ok": true,
      "count": 0,
      "ms": 3.447937000077218
    }
  },
  "query of a file outside the closure": {
    "outcome": "none: invalid position: file-not-in-closure",
    "ms": {
      "n": 5,
      "median": 259.90869399998337,
      "min": 256.17095900001004,
      "max": 265.9932359997183
    }
  }
}
```
