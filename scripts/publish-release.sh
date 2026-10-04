#!/bin/sh
# Publishes a release (release pipeline R1): a draft with all three assets first, then published and marked latest. On
# any failure the draft and its tag are deleted, so a published release always has every asset.
# Usage: publish-release.sh <tag> <sha> <assets dir>. Needs GH_TOKEN, GITHUB_SERVER_URL and GITHUB_REPOSITORY.
set -eu
tag=$1
sha=$2
dir=$3
subject=$(git log -1 --format=%s "$sha")
notes=$(printf '%s\n\nCommit %s\n%s/%s/commit/%s\n' "$subject" "$sha" "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$sha")
cleanup() {
  gh release delete "$tag" --yes --cleanup-tag >/dev/null 2>&1 || true
}
# A draft left by an earlier failed run.
cleanup
gh release create "$tag" --draft --target "$sha" --title "$tag" --notes "$notes" \
  "$dir/asterc-linux-x86_64" "$dir/asterc-c-seed.tar.gz" "$dir/SHA256SUMS" || { cleanup; exit 1; }
gh release edit "$tag" --draft=false --latest || { cleanup; exit 1; }
echo "published $tag"
