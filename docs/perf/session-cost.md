# Compiler session cost record (#62)

A measurement of the machine and inputs named below, made by `node scripts/session-cost.ts --record`. Raw samples are in
[`data/session-cost.json`](data/session-cost.json). These are not editor end-to-end latencies: VS Code's own scheduling is
not included.

```text
recorded        2026-10-10T01:23:43.488Z
gitCommit       2025f3d0c03f76139503197ef81927cef142f506
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
| launch (1 line) | check | 2.3 (2.2–2.4) | 1920 (1792–1920) | 117 | 0 |
| launch (1 line) | inspect | 2.5 (2.4–2.7) | 2304 (2176–2304) | 5803 | 0 |
| launch (1 line) | query | 4.0 (3.8–4.1) | 3328 (3200–3328) | 6188 | 0 |
| demo (2 files) | check | 2.2 (2.0–2.5) | 1920 (1792–1920) | 162 | 0 |
| demo (2 files) | inspect | 2.7 (2.6–3.0) | 2432 (2432–2432) | 8050 | 0 |
| demo (2 files) | query | 4.3 (4.2–4.6) | 3584 (3584–3584) | 8488 | 0 |
| compiler (18 files) | check | 144.9 (144.1–146.7) | 214616 (214484–214624) | 887 | 0 |
| compiler (18 files) | inspect | 239.8 (236.1–257.5) | 330076 (329936–330080) | 1742436 | 0 |
| compiler (18 files) | query | 363.4 (356.7–390.6) | 335236 (335160–335320) | 1743903 | 0 |
| generated (467 KiB) | check | 121.7 (121.1–124.8) | 105468 (105340–105472) | 118 | 0 |
| generated (467 KiB) | inspect | 554.3 (548.9–592.3) | 650412 (650408–650416) | 7877347 | 0 |
| generated (467 KiB) | query | 723.5 (711.3–775.1) | 673452 (673220–673456) | 7877522 | 0 |

Closure source bytes: launch (1 line) 29; demo (2 files) 410; compiler (18 files) 380354; generated (467 KiB) 477844.

First runs (nearest approximation of a cold run):

| Program | Command | First wall ms | First max RSS KiB |
| --- | --- | --- | --- |
| launch (1 line) | check | 3.4 | 1920 |
| launch (1 line) | inspect | 3.1 | 2176 |
| launch (1 line) | query | 4.2 | 3328 |
| demo (2 files) | check | 2.2 | 1920 |
| demo (2 files) | inspect | 2.7 | 2432 |
| demo (2 files) | query | 4.1 | 3584 |
| compiler (18 files) | check | 151.6 | 214388 |
| compiler (18 files) | inspect | 250.9 | 330076 |
| compiler (18 files) | query | 353.3 | 335320 |
| generated (467 KiB) | check | 124.8 | 105256 |
| generated (467 KiB) | inspect | 593.3 | 650416 |
| generated (467 KiB) | query | 724.6 | 673452 |

## Adapter side (in process, compiler-closure query response)

Response: 1743903 bytes, 18 files.

| Step | ms median (min–max) |
| --- | --- |
| jsonParseMs | 6.086 (5.909–7.881) |
| readbackHashMs | 0.628 (0.353–2.863) |
| byteOffsetMs | 0.170 (0.169–0.889) |

## Adapter round trip (`Session.query`, sequential)

| Program | ms median (min–max) | Outcomes |
| --- | --- | --- |
| demo (2 files) | 4.3 (3.9–6.5) | answer |
| compiler (18 files) | 365.8 (363.8–375.6) | answer |

## Workloads (compiler closure unless named)

```json
{
  "hover sweep, sequential": {
    "requests": 20,
    "totalMs": 7412.170524999965,
    "peakProcesses": 1,
    "peakRssKiB": 335280,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 370.9846724999952,
      "min": 362.014766999986,
      "max": 379.3822879999643
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, overlap": {
    "requests": 20,
    "totalMs": 1237.6186580000212,
    "peakProcesses": 17,
    "peakRssKiB": 3186556,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 617.6304204999469,
      "min": 478.0172949999105,
      "max": 665.2184660000494
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, cancel-previous": {
    "requests": 20,
    "totalMs": 1017.4650230000261,
    "peakProcesses": 2,
    "peakRssKiB": 332024,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 37.350044000020716,
      "min": 36.00956699997187,
      "max": 375.4117130000377
    },
    "kinds": {
      "cancelled": 19,
      "answer": 1
    }
  },
  "rapid saves (5 checks, 30 ms apart)": {
    "totalMs": 286.8438819999574,
    "peakProcesses": 2,
    "peakRssKiB": 214188,
    "leftover": 0,
    "perRequestMs": {
      "n": 5,
      "median": 36.849138999939896,
      "min": 36.195136999944225,
      "max": 153.96042999997735
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
      "ms": 4.010293000028469
    },
    "fixed": {
      "ok": true,
      "count": 0,
      "ms": 2.8657039999961853
    }
  },
  "query of a file outside the closure": {
    "outcome": "none: invalid position: file-not-in-closure",
    "ms": {
      "n": 5,
      "median": 364.151343000005,
      "min": 360.8996820000466,
      "max": 374.64327499992214
    }
  }
}
```
