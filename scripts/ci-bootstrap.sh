#!/bin/sh
# CI's bootstrap (release pipeline R1): from the release of HEAD^1, the base of the change, so a change that uses a
# feature its base's release lacks fails here (the two-step rule). 
set -u
cd "$(dirname "$0")/.."
tag=$(sh scripts/release-base.sh HEAD^1)
case $? in
  0) exec pnpm -s bootstrap --release "$tag" ;;
  3)
    echo 'ci-bootstrap: no build-* release exists; see Recovery in docs/self-host/building.md' >&2
    exit 1
    ;;
  *) exit 1 ;;
esac
