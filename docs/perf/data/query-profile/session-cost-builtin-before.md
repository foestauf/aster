# Compiler session cost record (#62)

A measurement of the machine and inputs named below, made by `node scripts/session-cost.ts --record`. Raw samples are in
[`data/session-cost.json`](data/session-cost.json). These are not editor end-to-end latencies: VS Code's own scheduling is
not included.

```text
recorded        2026-10-11T03:07:21.165Z
gitCommit       cb7a170460671ba7fafe78b9858f5e99e12fc740
gitDirty        true
compilerSha256  8de66f8ae800f20b1d4fc3579586a18cd56aa39e37d60a49eff2cea1af48d00d
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
| launch (1 line) | check | 2.1 (1.9–2.2) | 896 (896–896) | 117 | 0 |
| launch (1 line) | inspect | 2.3 (2.1–2.5) | 1152 (1152–1152) | 6006 | 0 |
| launch (1 line) | query | 3.8 (3.5–4.1) | 2176 (2176–2176) | 6391 | 0 |
| demo (2 files) | check | 2.0 (1.9–2.4) | 1024 (1024–1024) | 162 | 0 |
| demo (2 files) | inspect | 2.3 (2.2–2.8) | 1280 (1280–1280) | 8253 | 0 |
| demo (2 files) | query | 4.1 (3.8–4.3) | 2304 (2304–2304) | 8691 | 0 |
| compiler (18 files) | check | 64.4 (63.3–72.3) | 48508 (48388–48536) | 841 | 0 |
| compiler (18 files) | inspect | 119.5 (117.9–121.2) | 112250 (112156–112256) | 1697342 | 0 |
| compiler (18 files) | query | 240.2 (237.3–245.6) | 115828 (115704–115848) | 1698733 | 0 |
| generated (467 KiB) | check | 119.9 (116.9–139.2) | 99972 (99872–99976) | 118 | 0 |
| generated (467 KiB) | inspect | 387.4 (373.6–405.7) | 414476 (414452–414480) | 7877553 | 0 |
| generated (467 KiB) | query | 547.3 (540.6–565.3) | 429834 (429716–429928) | 7877728 | 0 |

Closure source bytes: launch (1 line) 29; demo (2 files) 410; compiler (18 files) 378189; generated (467 KiB) 477844.

First runs (nearest approximation of a cold run):

| Program | Command | First wall ms | First max RSS KiB |
| --- | --- | --- | --- |
| launch (1 line) | check | 3.3 | 896 |
| launch (1 line) | inspect | 2.7 | 1152 |
| launch (1 line) | query | 4.0 | 2176 |
| demo (2 files) | check | 2.0 | 1024 |
| demo (2 files) | inspect | 2.3 | 1280 |
| demo (2 files) | query | 3.9 | 2304 |
| compiler (18 files) | check | 65.2 | 48508 |
| compiler (18 files) | inspect | 128.9 | 112252 |
| compiler (18 files) | query | 242.5 | 115832 |
| generated (467 KiB) | check | 126.3 | 99972 |
| generated (467 KiB) | inspect | 398.3 | 414416 |
| generated (467 KiB) | query | 548.6 | 429840 |

## Adapter side (in process, compiler-closure query response)

Response: 1698733 bytes, 17 files.

| Step | ms median (min–max) |
| --- | --- |
| jsonParseMs | 6.434 (5.777–11.823) |
| readbackHashMs | 0.606 (0.433–1.027) |
| byteOffsetMs | 0.173 (0.171–2.155) |

## Adapter round trip (`Session.query`, sequential)

| Program | ms median (min–max) | Outcomes |
| --- | --- | --- |
| demo (2 files) | 4.8 (4.4–9.3) | answer |
| compiler (18 files) | 249.5 (244.5–280.7) | answer |

## Workloads (compiler closure unless named)

```json
{
  "hover sweep, sequential": {
    "requests": 20,
    "totalMs": 5054.871608999558,
    "peakProcesses": 1,
    "peakRssKiB": 116032,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 250.74585850024596,
      "min": 244.24022700078785,
      "max": 276.7476439997554
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, overlap": {
    "requests": 20,
    "totalMs": 1028.8426289996132,
    "peakProcesses": 12,
    "peakRssKiB": 637868,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 407.1015490000136,
      "min": 314.05965799931437,
      "max": 453.14846199937165
    },
    "kinds": {
      "answer": 20
    }
  },
  "hover sweep, cancel-previous": {
    "requests": 20,
    "totalMs": 896.7750329999253,
    "peakProcesses": 2,
    "peakRssKiB": 113736,
    "leftover": 0,
    "perRequestMs": {
      "n": 20,
      "median": 37.798752000089735,
      "min": 36.58287800010294,
      "max": 251.89304600004107
    },
    "kinds": {
      "cancelled": 19,
      "answer": 1
    }
  },
  "rapid saves (5 checks, 30 ms apart)": {
    "totalMs": 210.59973399993032,
    "peakProcesses": 2,
    "peakRssKiB": 46720,
    "leftover": 0,
    "perRequestMs": {
      "n": 5,
      "median": 38.41367100086063,
      "min": 38.07641400024295,
      "max": 72.84688999969512
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
      "ms": 3.7078939992934465
    },
    "fixed": {
      "ok": true,
      "count": 0,
      "ms": 2.785323000513017
    }
  },
  "query of a file outside the closure": {
    "outcome": "none: invalid position: file-not-in-closure",
    "ms": {
      "n": 5,
      "median": 242.88451300002635,
      "min": 242.23553000018,
      "max": 250.91940599959344
    }
  }
}
```
