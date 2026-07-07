#!/bin/bash
# SprintSpends installer — run this once, or again to update
set -e

REPO_DIR="$HOME/.sprintspends/app"

echo "SprintSpends Installer"
echo ""

# Clone or update
if [ -d "$REPO_DIR" ]; then
  echo "Updating SprintSpends..."
  cd "$REPO_DIR"
  git pull --quiet
else
  echo "Installing SprintSpends..."
  mkdir -p "$HOME/.sprintspends"
  git clone https://github.com/sellmaai/sprintspend.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

# Install deps and build
npm install --silent
npm run build --silent

# Link globally
npm link --silent 2>/dev/null || sudo npm link --silent

echo ""
echo "Running sprintspends configure..."
echo ""
sprintspends configure
