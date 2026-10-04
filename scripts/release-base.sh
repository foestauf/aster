#!/bin/sh
# Prints the build-* release tag of <rev>; CI passes HEAD^1, the base of the change under test (release pipeline R1).
# Waits while release.yml publishes it. Exit 0: tag printed. Exit 3: no build-* release exists anywhere yet, so the
# caller bootstraps from the TypeScript seed. Exit 1: <rev> is unknown, or still has no release after the wait.
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
    echo "release for $sha not published yet; re-run this job when release.yml finishes" >&2
    exit 1
  fi
  sleep "$interval"
done
