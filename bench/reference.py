#!/usr/bin/env python3
"""Independent, arbitrary-precision reference answers; no Aster compiler needed.

Run `python3 bench/reference.py` to verify the declared stdout expectations.
These deliberately simple references are correctness oracles, not benchmarks.
"""

from pathlib import Path


def integer_loops():
    state = 1
    checksum = 0
    for i in range(40_000_000):
        state = (state * 48_271) % 2_147_483_647
        checksum = (checksum + state + i % 97) % 1_000_000_007
    return checksum


def array_sort():
    state = 1
    checksum = 0
    for _ in range(3):
        values = []
        for _ in range(262_144):
            state = (state * 48_271) % 2_147_483_647
            values.append(state % 1_000_003)
        # Python's Timsort is independent of the Aster heap-sort implementation.
        checksum += sum(i * n for i, n in enumerate(sorted(values), 1))
    return checksum


def string_build():
    checksum = 0
    for batch in range(2048):
        # Join once rather than mirror the Aster concatenation algorithm.
        text = ''.join(f'{(batch * 131 + i * 17) % 1000}:' for i in range(128))
        for byte in text.encode('ascii') * 16:
            checksum = (checksum * 33 + byte) % 1_000_000_007
    return checksum


def struct_enum():
    # Tuples of score/active reproduce values without an enum or mutable structs.
    records = [(i * 7, True) for i in range(4096)]
    state = 1
    checksum = 0
    for i in range(2_000_000):
        state = (state * 48_271) % 2_147_483_647
        slot = i % 4096
        score, active = records[slot]
        score = (score + state) % 1_000_003
        if state % 3 == 0:
            score = (score + state % 97) % 1_000_003
            checksum += score + i
        elif state % 3 == 1:
            score = score * (state % 7 + 1) % 1_000_003
            checksum += score - i
        else:
            active = not active
            checksum += score if active else -score
        records[slot] = (score, active)
    return checksum + sum(score for score, _ in records)


def calc_interpreter():
    # Algebraic evaluators are independent of Aster's tokenizer/parser/AST walk.
    # All division/modulo operands below are nonnegative, so Python // agrees
    # with Aster's integer division (which truncates toward zero).
    evaluators = [
        lambda x: (x + 23) * (31 - 7) + 99 // 3 - 5 * (8 + 2),
        lambda x: x * 7 + (81 // 9 - 2) * (13 + 4) - 101 % 7,
        lambda x: (x % 97 + 1) * (x % 31 + 2) - (45 - 12) // 3,
        lambda x: -(x % 113) + (17 * 19 - 23) * 3 + x // 11,
    ]
    return sum(evaluators[batch % 4](batch + offset)
               for batch in range(40_000) for offset in range(12))


def main():
    root = Path(__file__).resolve().parent
    references = {
        'array_sort': array_sort,
        'calc_interpreter': calc_interpreter,
        'integer_loops': integer_loops,
        'string_build': string_build,
        'struct_enum': struct_enum,
    }
    success = True
    for name, reference in references.items():
        actual = str(reference()) + '\n'
        source = (root / f'{name}.aster').read_text()
        expected = ''.join(line.split(':', 1)[1].lstrip() + '\n'
                           for line in source.splitlines()
                           if line.startswith('// expect-stdout:'))
        matches = actual == expected
        print(f'{name}: {actual.strip()} ({"PASS" if matches else "MISMATCH"})', flush=True)
        success &= matches
    return 0 if success else 1


if __name__ == '__main__':
    raise SystemExit(main())
