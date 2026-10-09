#!/bin/sh
# Prints the build-* release tag of <rev>; CI passes HEAD^1, the base of the change under test (release pipeline R1).
# Waits while release.yml publishes it. If the wait runs out, warns and prints the nearest ancestor build-* tag instead
# (an older release can only reject a change, never wrongly accept it, so one failed CI run can't wedge main).
# Only pushes to main publish releases, so a <rev> that origin/main doesn't contain (a stacked pull request's base)
# skips the wait and falls back at once.
# Exit 0: tag printed. Exit 3: no build-* release exists anywhere yet, so the caller bootstraps from the TypeScript
# seed. Exit 1: <rev> is unknown, or has no release and no ancestor release.
set -u
rev=${1:?usage: release-base.sh <rev>}
tries=${ASTER_RELEASE_WAIT_TRIES:-30}
interval=${ASTER_RELEASE_WAIT_INTERVAL:-30}
sha=$(git rev-parse --verify --quiet "$rev^{commit}") || { echo "release-base: unknown revision $rev" >&2; exit 1; }
# Prints the nearest ancestor build-* tag of <rev>, warning with the reason in $1, or fails if there is none.
fallback() {
  if tag=$(git describe --tags --match 'build-*' --abbrev=0 "$sha" 2>/dev/null); then
    echo "$1; falling back to the nearest earlier release" >&2
    echo "::warning::$1; falling back to $tag" >&2
    echo "$tag"
    exit 0
  fi
  echo "$1, and no earlier release is an ancestor of it" >&2
  exit 1
}
i=0
while :; do
  git fetch --quiet --tags --force origin 2>/dev/null || true
  tag=$(git tag --points-at "$sha" --list 'build-*' | sort | tail -n 1)
  if [ -n "$tag" ]; then
    echo "$tag"
    exit 0
  fi
  if [ -z "$(git tag --list 'build-*')" ]; then
    exit 3
  fi
  if git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null \
    && ! git merge-base --is-ancestor "$sha" refs/remotes/origin/main; then
    fallback "$sha is not on main, so it gets no release"
  fi
  i=$((i + 1))
  if [ "$i" -ge "$tries" ]; then
    fallback "release for $sha not published yet"
  fi
  sleep "$interval"
done
