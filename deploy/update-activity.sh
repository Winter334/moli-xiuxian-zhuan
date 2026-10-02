#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
env_file=${1:-/etc/moli-activity.env}
profile=${2:-}
compose=(docker compose --env-file "$env_file" -f compose.activity.yaml)
if [[ "$profile" == --https ]]; then compose+=(--profile https); elif [[ -n "$profile" ]]; then exit 2; fi
revision=$(git rev-parse HEAD)
if ! git diff --quiet HEAD --; then
  echo "Commit tracked deployment changes before updating, so backup metadata identifies the code." >&2
  exit 1
fi

# Build first, but do not start code that can migrate the database until the dump succeeds.
"${compose[@]}" build app
"${compose[@]}" up -d --wait postgres
"${compose[@]}" run --rm --no-deps backup /bin/bash /scripts/activity-backup.sh update "$revision"
"${compose[@]}" up -d
healthy=0
for attempt in {1..30}; do
  if "${compose[@]}" exec -T app node -e \
    "fetch('http://127.0.0.1:5180/api/health', {signal: AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" != 1 ]]; then
  echo "Deployment health check failed. The original pre-update archive remains protected; no automatic rollback was attempted." >&2
  exit 1
fi
"${compose[@]}" run --rm --no-deps backup /bin/bash /scripts/activity-backup.sh complete "$revision"
echo "Deployment healthy; three independent backup slots are retained."
