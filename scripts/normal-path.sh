#!/bin/sh
# The normal-path check (issue #21): with the TypeScript seed's dist/ hidden, rebuild the compiler with itself, build
# it through `pnpm aster`, and build and run representative programs. Run it after `pnpm bootstrap`.
set -u
cd "$(dirname "$0")/.."
dist=packages/asterc/dist
step=setup

fail() {
  echo "normal path: FAIL ($step)${1:+: $1}" >&2
  exit 1
}

[ -x build/asterc ] || { echo 'aster: no compiler at build/asterc; run `pnpm bootstrap` first' >&2; exit 2; }
if [ -e "$dist.hidden" ]; then
  fail "$dist.hidden exists; restore it to $dist first"
fi

work=$(mktemp -d "${TMPDIR:-/tmp}/aster-normal-path-XXXXXX")
restore() {
  if [ -e "$dist.hidden" ]; then
    rm -rf "$dist"
    mv "$dist.hidden" "$dist"
  fi
  rm -rf "$work"
}
trap restore EXIT
trap 'exit 1' INT TERM HUP
if [ -e "$dist" ]; then
  mv "$dist" "$dist.hidden"
fi

step='pnpm build (self-rebuild)'
pnpm -s build || fail

step='pnpm aster build of the compiler'
pnpm -s aster build packages/asterc-self/asterc.aster -o "$work/asterc" || fail
"$work/asterc" build packages/asterc-self/asterc.aster --emit=c > "$work/a.c" || fail
build/asterc build packages/asterc-self/asterc.aster --emit=c > "$work/b.c" || fail
cmp -s "$work/a.c" "$work/b.c" || fail 'its --emit=c differs from build/asterc'

# The expect-stdout block of a golden program's header, without the comment markers.
expected() {
  awk '
    !/^\/\// { exit }
    /^\/\/ ?expect-stdout:$/ { on = 1; next }
    /^\/\/ ?expect-/ { on = 0; next }
    on { sub(/^\/\/ ?/, ""); print }
  ' "$1"
}

check() {
  prog=$1
  shift
  step="pnpm aster run $prog"
  pnpm -s aster run "tests/programs/$prog" "$@" > "$work/out" || fail "exit $?"
  expected "tests/programs/$prog" > "$work/want"
  [ -s "$work/want" ] || fail 'no expect-stdout block'
  cmp -s "$work/want" "$work/out" || fail "stdout differs: $(diff "$work/want" "$work/out" | head -5)"
}

check basics/hello.aster
check programs/rpn.aster
check programs/calc.aster
check modules/diamond.aster
check programs/lex.aster -- tests/programs/programs/fixtures/lex_sample.txt

echo 'normal path: PASS'
