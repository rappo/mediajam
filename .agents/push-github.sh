#!/usr/bin/env bash
# Push the latest Forgejo commit(s) to GitHub with incremental history.
#
# Usage:
#   ./.agents/push-github.sh          # cherry-pick the last commit
#   ./.agents/push-github.sh 3        # cherry-pick the last 3 commits
#
# The github-main branch maintains a clean history starting from the
# "Initial release" orphan commit on GitHub. Each Forgejo commit is
# cherry-picked onto it and pushed incrementally.

set -euo pipefail

COUNT="${1:-1}"
GITHUB_REMOTE="github"

# Ensure github-main branch exists
if ! git rev-parse --verify github-main &>/dev/null; then
    echo "❌ github-main branch not found. Run the initial orphan push first."
    exit 1
fi

# Get the commit SHAs to cherry-pick (oldest first)
COMMITS=$(git log --reverse --format=%H -n "$COUNT" main)

if [ -z "$COMMITS" ]; then
    echo "❌ No commits found on main"
    exit 1
fi

echo "🔄 Cherry-picking $COUNT commit(s) from main → github-main..."

git checkout github-main --quiet

for SHA in $COMMITS; do
    MSG=$(git log --format=%s -1 "$SHA")
    echo "  → $MSG"
    git cherry-pick "$SHA" --no-edit || {
        echo "❌ Cherry-pick conflict on $SHA. Resolve manually, then:"
        echo "   git cherry-pick --continue"
        echo "   git push $GITHUB_REMOTE github-main:main"
        echo "   git checkout main"
        exit 1
    }
done

echo "📤 Pushing to GitHub..."
git push "$GITHUB_REMOTE" github-main:main

git checkout main --quiet
echo "✅ Done. GitHub is up to date."
