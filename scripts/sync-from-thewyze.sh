#!/usr/bin/env bash
# Copy the public blog MCP server's source from the Wyze app (Front-End) into src/, at the same paths.
# Usage: scripts/sync-from-thewyze.sh [path to the Front-End repo, default ../Front-End]
set -euo pipefail
cd "$(dirname "$0")/.."
APP="${1:-../Front-End}"
[ -f "$APP/src/lib/mcp/serverInfo.ts" ] || { echo "Wyze app not found at $APP" >&2; exit 1; }

FILES=(
    src/app/api/mcp/route.ts
    "src/app/.well-known/mcp/server.json/route.ts"
    src/lib/mcp/serverInfo.ts
)
rm -rf src
for f in "${FILES[@]}"; do
    mkdir -p "$(dirname "$f")"
    cp "$APP/$f" "$f"
done
echo "Synced ${#FILES[@]} files from $APP"
