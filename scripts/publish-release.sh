#!/bin/sh
# Keep the workflow entry point; Node handles API responses without ambiguous shell error paths.
set -eu
exec node "$(dirname "$0")/publish-release.ts" "$@"
