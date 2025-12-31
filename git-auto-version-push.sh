#!/bin/bash

# Get bump type from the first argument or default to 'patch'
BUMP_TYPE=${1:-patch}

# Get commit message from the second argument or use a default
COMMIT_MSG=${2:-"Automated commit"}

# Stage all changes
git add .

# Commit with the given message
git commit -m "$COMMIT_MSG"

# Bump version with npm using the specified bump type
npm version $BUMP_TYPE -m "Version bump to %s via automation"

# Push commits and tags to remote
git push --follow-tags
echo "Version bumped and changes pushed successfully."