#!/bin/sh
# Prints the build-* release tag of <rev>; CI passes HEAD^1, the base of the change under test (release pipeline R1).
# Waits while release.yml publishes it. If the wait runs out, warns and prints the nearest ancestor build-* tag instead
# (an older release can only reject a change, never wrongly accept it, so one failed CI run can't wedge main).
# Exit 0: tag printed. Exit 3: no build-* release exists anywhere yet, so the caller bootstraps from the TypeScript
# seed. Exit 1: <rev> is unknown, or has no release and no ancestor release.
set -u
rev=${1:?usage: release-base.sh <rev>}
tries=${ASTER_RELEASE_WAIT_TRIES:-30}
interval=${ASTER_RELEASE_WAIT_INTERVAL:-30}
sha=$(git rev-parse --verify --quiet "$rev^{commit}") || { echo "release-base: unknown revision $rev" >&2; exit 1; }
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
  i=$((i + 1))
  if [ "$i" -ge "$tries" ]; then
    if tag=$(git describe --tags --match 'build-*' --abbrev=0 "$sha" 2>/dev/null); then
      echo "release for $sha not published yet; falling back to the nearest earlier release" >&2
      echo "::warning::release for $sha not published yet; falling back to $tag" >&2
      echo "$tag"
      exit 0
    fi
    echo "release for $sha not published yet, and no earlier release is an ancestor of it" >&2
    exit 1
  fi
  sleep "$interval"
done
