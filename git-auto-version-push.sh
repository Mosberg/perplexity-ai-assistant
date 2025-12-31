#!/bin/bash

set -euo pipefail

# Usage info
usage() {
    echo "Usage: $0 [patch|minor|major] [commit message]"
    exit 1
}

# Validate bump type
BUMP_TYPE=${1:-patch}
if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
    echo "Error: Invalid version bump type: $BUMP_TYPE"
    usage
fi

# Commit message
COMMIT_MSG=${2:-"Automated commit"}

# Ensure working directory is clean
if ! git diff-index --quiet HEAD --; then
    git add .
    git commit -m "$COMMIT_MSG"
else
    echo "No changes to commit."
fi

# Pull latest changes to avoid conflicts
git pull --rebase

# Bump version
npm version "$BUMP_TYPE" -m "Version bump to %s via automation"

# Push commits and tags
git push --follow-tags

echo "✅ Version bumped ($BUMP_TYPE) and changes pushed successfully."