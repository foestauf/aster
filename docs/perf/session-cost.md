# Compiler session cost record (#62)

A measurement of the machine and inputs named below, made by `node scripts/session-cost.ts --record`. Raw samples are in
[`data/session-cost.json`](data/session-cost.json). These are not editor end-to-end latencies: VS Code's own scheduling is
not included.

```text
recorded        2026-10-10T01:37:49.256Z
gitCommit       70c12cecf3ef716c58d77e62b289f469e4f0d57d
gitDirty        false
compilerSha256  056f826e37d83d75db4b071bccbfd1e97fcadc2fa16abcb2564cefeac56ead9e
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
| launch (1 line) | check | 2.3 (2.1–2.7) | 1920 (1792–1920) | 117 | 0 |
| launch (1 line) | inspect | 2.6 (2.4–3.1) | 2304 (2176–2304) | 5803 | 0 |
| launch (1 line) | query | 4.1 (3.9–4.3) | 3328 (3200–3328) | 6188 | 0 |
| demo (2 files) | check | 2.2 (2.1–2.7) | 1920 (1920–1920) | 162 | 0 |
| demo (2 files) | inspect | 2.8 (2.7–3.0) | 2432 (2304–2432) | 8050 | 0 |
| demo (2 files) | query | 4.3 (4.1–4.4) | 3584 (3456–3584) | 8488 | 0 |
| compiler (18 files) | check | 148.9 (144.4–185.5) | 214620 (214440–214664) | 887 | 0 |
| compiler (18 files) | inspect | 239.5 (237.8–269.0) | 330076 (329836–330080) | 1742436 | 0 |
| compiler (18 files) | query | 360.5 (354.2–395.2) | 335318 (335164–335324) | 1743903 | 0 |
| generated (467 KiB) | check | 122.8 (120.9–154.0) | 105468 (105256–105472) | 118 | 0 |
| generated (467 KiB) | inspect | 573.1 (550.0–679.5) | 650410 (650240–650416) | 7877347 | 0 |
| generated (467 KiB) | query | 737.8 (711.9–822.3) | 673358 (673212–673452) | 7877522 | 0 |

Closure source bytes: launch (1 line) 29; demo (2 files) 410; compiler (18 files) 380354; generated (467 KiB) 477844.

First runs (nearest approximation of a cold run):

| Program | Command | First wall ms | First max RSS KiB |
| --- | --- | --- | --- |
| launch (1 line) | check | 3.3 | 1920 |
| launch (1 line) | inspect | 3.2 | 2304 |
| launch (1 line) | query | 4.1 | 3200 |
| demo (2 files) | check | 2.1 | 1920 |
| demo (2 files) | inspect | 2.6 | 2432 |
| demo (2 files) | query | 4.3 | 3456 |
| compiler (18 files) | check | 146.6 | 214616 |
| compiler (18 files) | inspect | 239.9 | 329952 |
| compiler (18 files) | query | 438.2 | 335196 |
| generated (467 KiB) | check | 125.7 | 105464 |
| generated (467 KiB) | inspect | 625.3 | 650416 |
| generated (467 KiB) | query | 718.2 | 673244 |

## Adapter side (in process, compiler-closure query response)

Response: 1743903 bytes, 18 files.

| Step | ms median (min–max) |
| --- | --- |
| jsonParseMs | 6.190 (5.934–7.908) |
| readbackHashMs | 0.582 (0.346–2.591) |
| byteOffsetMs | 0.171 (0.169–0.936) |

## Adapter round trip (`Session.query`, sequential)

| Program | ms median (min–max) | Outcomes |
| --- | --- | --- |
| demo (2 files) | 4.5 (4.2–7.0) | answer |
| compiler (18 files) | 367.6 (360.6–410.6) | answer |

## Workloads (compiler closure unless named)

```json
{
  "hover sweep, sequential": {
    "requests": 20,
    "totalMs": 7552.329275000142,
    "peakProcesses": 1,
    "peakRssKiB": 335336,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 370.7589460000163,
      "min": 364.8431480000727,
      "max": 421.27713999990374
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, overlap": {
    "requests": 20,
    "totalMs": 1306.8083299999125,
    "peakProcesses": 18,
    "peakRssKiB": 3499992,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 683.3209369999822,
      "min": 594.5168649998959,
      "max": 792.5764159997925
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, cancel-previous": {
    "requests": 20,
    "totalMs": 1008.0654380000196,
    "peakProcesses": 2,
    "peakRssKiB": 335256,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 36.745355000020936,
      "min": 36.02354500000365,
      "max": 372.48430599994026
    },
    "kinds": {
      "cancelled": 19,
      "answer": 1
    }
  },
  "rapid saves (5 checks, 30 ms apart)": {
    "totalMs": 283.4751909999177,
    "peakProcesses": 2,
    "peakRssKiB": 212824,
    "leftover": 0,
    "perRequestMs": {
      "n": 5,
      "median": 36.86958599998616,
      "min": 36.3341510000173,
      "max": 149.0143889999017
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
      "ms": 4.054892000043765
    },
    "fixed": {
      "ok": true,
      "count": 0,
      "ms": 3.008093000156805
    }
  },
  "query of a file outside the closure": {
    "outcome": "none: invalid position: file-not-in-closure",
    "ms": {
      "n": 5,
      "median": 366.6803010001313,
      "min": 359.1841720000375,
      "max": 373.6068240001332
    }
  }
}
```
