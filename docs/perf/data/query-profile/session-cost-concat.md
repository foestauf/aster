# Compiler session cost record (#62)

A measurement of the machine and inputs named below, made by `node scripts/session-cost.ts --record`. Raw samples are in
[`data/session-cost.json`](data/session-cost.json). These are not editor end-to-end latencies: VS Code's own scheduling is
not included.

```text
recorded        2026-10-11T02:39:18.708Z
gitCommit       67dac81650270f04b463fd4df2e4c9905adf8d19
gitDirty        true
compilerSha256  a4d131a52302cafa5a27364607dd90a69f4c1ae61049489bdabe359533aa928b
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
| launch (1 line) | check | 2.2 (2.1–2.4) | 1920 (1792–1920) | 117 | 0 |
| launch (1 line) | inspect | 2.4 (2.2–2.7) | 2176 (2048–2176) | 5803 | 0 |
| launch (1 line) | query | 4.1 (4.0–4.3) | 3200 (3200–3200) | 6188 | 0 |
| demo (2 files) | check | 2.3 (2.2–2.7) | 1920 (1792–1920) | 162 | 0 |
| demo (2 files) | inspect | 2.7 (2.4–2.8) | 2304 (2176–2304) | 8050 | 0 |
| demo (2 files) | query | 4.3 (4.1–4.8) | 3328 (3200–3328) | 8488 | 0 |
| compiler (18 files) | check | 75.0 (69.4–77.4) | 50720 (50540–50748) | 887 | 0 |
| compiler (18 files) | inspect | 154.3 (139.8–186.0) | 116412 (116408–116412) | 1742441 | 0 |
| compiler (18 files) | query | 251.9 (249.0–272.9) | 119860 (119612–119904) | 1743908 | 0 |
| generated (467 KiB) | check | 131.6 (124.3–148.1) | 100816 (100688–100820) | 118 | 0 |
| generated (467 KiB) | inspect | 405.5 (391.9–441.5) | 415414 (415272–415456) | 7877347 | 0 |
| generated (467 KiB) | query | 563.5 (554.0–576.7) | 430686 (430668–430816) | 7877522 | 0 |

Closure source bytes: launch (1 line) 29; demo (2 files) 410; compiler (18 files) 385081; generated (467 KiB) 477844.

First runs (nearest approximation of a cold run):

| Program | Command | First wall ms | First max RSS KiB |
| --- | --- | --- | --- |
| launch (1 line) | check | 3.5 | 1920 |
| launch (1 line) | inspect | 3.0 | 2048 |
| launch (1 line) | query | 4.0 | 3200 |
| demo (2 files) | check | 2.8 | 1920 |
| demo (2 files) | inspect | 2.8 | 2304 |
| demo (2 files) | query | 4.5 | 3328 |
| compiler (18 files) | check | 71.9 | 50748 |
| compiler (18 files) | inspect | 149.1 | 116408 |
| compiler (18 files) | query | 270.3 | 119868 |
| generated (467 KiB) | check | 124.4 | 100812 |
| generated (467 KiB) | inspect | 408.9 | 415328 |
| generated (467 KiB) | query | 553.9 | 430816 |

## Adapter side (in process, compiler-closure query response)

Response: 1743908 bytes, 18 files.

| Step | ms median (min–max) |
| --- | --- |
| jsonParseMs | 6.272 (6.017–8.061) |
| readbackHashMs | 0.618 (0.360–3.044) |
| byteOffsetMs | 0.172 (0.171–1.070) |

## Adapter round trip (`Session.query`, sequential)

| Program | ms median (min–max) | Outcomes |
| --- | --- | --- |
| demo (2 files) | 4.3 (4.1–6.8) | answer |
| compiler (18 files) | 263.5 (260.3–269.9) | answer |

## Workloads (compiler closure unless named)

```json
{
  "hover sweep, sequential": {
    "requests": 20,
    "totalMs": 5256.93122899998,
    "peakProcesses": 1,
    "peakRssKiB": 119840,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 261.9920620000921,
      "min": 257.4634960000403,
      "max": 275.3310150001198
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, overlap": {
    "requests": 20,
    "totalMs": 980.7446590000764,
    "peakProcesses": 10,
    "peakRssKiB": 590516,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 344.4514209998306,
      "min": 310.3164889998734,
      "max": 383.2873120000586
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, cancel-previous": {
    "requests": 20,
    "totalMs": 912.378115999978,
    "peakProcesses": 2,
    "peakRssKiB": 115340,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 38.063281500013545,
      "min": 37.119446999859065,
      "max": 262.6836609998718
    },
    "kinds": {
      "cancelled": 19,
      "answer": 1
    }
  },
  "rapid saves (5 checks, 30 ms apart)": {
    "totalMs": 209.09081100020558,
    "peakProcesses": 2,
    "peakRssKiB": 49888,
    "leftover": 0,
    "perRequestMs": {
      "n": 5,
      "median": 37.60160099994391,
      "min": 36.845027999952435,
      "max": 74.47657800000161
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
      "ms": 4.5283969999291
    },
    "fixed": {
      "ok": true,
      "count": 0,
      "ms": 3.101081000175327
    }
  },
  "query of a file outside the closure": {
    "outcome": "none: invalid position: file-not-in-closure",
    "ms": {
      "n": 5,
      "median": 256.2112420001067,
      "min": 254.33816900011152,
      "max": 262.37658399995416
    }
  }
}
```
