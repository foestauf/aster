#!/bin/sh
# CI's bootstrap (release pipeline R1): from the release of HEAD^1, the base of the change, so a change that uses a
# feature its base's release lacks fails here (the two-step rule).
# Optimistic by default (#69): it starts at once from the newest release already published on HEAD^1 or an ancestor.
# An older release can only reject a change, never wrongly accept it, so only a failure from an older release is
# retried: release-base.sh then waits for HEAD^1's own release as before, and the bootstrap runs once more if the wait
# finds a different release. ASTER_BOOTSTRAP_STRICT=1 (release.yml, so each published seed is built by its parent's)
# skips the optimistic try.
set -u
cd "$(dirname "$0")/.."
no_release() {
  echo 'ci-bootstrap: no build-* release exists; see Recovery in docs/self-host/building.md' >&2
  exit 1
}
strict_tag() {
  tag=$(sh scripts/release-base.sh HEAD^1)
  case $? in
    0) ;;
    3) no_release ;;
    *) exit 1 ;;
  esac
}
if [ "${ASTER_BOOTSTRAP_STRICT:-}" = 1 ]; then
  strict_tag
  exec pnpm -s bootstrap --release "$tag"
fi
tag=$(sh scripts/release-base.sh --no-wait HEAD^1)
case $? in
  0) ;;
  3) no_release ;;
  *) exit 1 ;;
esac
if [ -n "$(git tag --points-at HEAD^1 --list "$tag")" ]; then
  exec pnpm -s bootstrap --release "$tag"
fi
first=$tag
echo "::notice::optimistic bootstrap from $first (HEAD^1, $(git rev-parse HEAD^1), has no published release)" >&2
pnpm -s bootstrap --release "$first"
status=$?
[ "$status" = 0 ] && exit 0
echo "::warning::optimistic bootstrap from $first failed; retrying with the release of HEAD^1" >&2
strict_tag
if [ "$tag" = "$first" ]; then
  echo "ci-bootstrap: no newer release than $first appeared; its bootstrap failure stands" >&2
  exit "$status"
fi
exec pnpm -s bootstrap --release "$tag"
