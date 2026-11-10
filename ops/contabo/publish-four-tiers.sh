#!/usr/bin/env bash
# Canonical IRON paid-tier publication on the EXISTING Contabo instance only.
# Read-only by default. Controlled apply never migrates an existing subscription.
set -euo pipefail
MODE=${1:---check}
[[ "$MODE" == --check || "$MODE" == --apply ]] || { echo 'Usage: publish-four-tiers.sh [--check|--apply]' >&2; exit 2; }
cd /opt/fm/ironfit
[[ -r .deployed ]] || { echo 'No certified deploy marker' >&2; exit 3; }
# shellcheck disable=SC1091
. ./.deployed
[[ -n "${BACKEND_SHA:-}" && -n "${APP_SHA:-}" ]] || { echo 'Deployment identity absent' >&2; exit 3; }
[[ "$(git -C src/backend rev-parse HEAD)" == "$BACKEND_SHA" ]] || { echo 'Backend checkout differs from deployed SHA' >&2; exit 3; }
[[ "$(git -C src/app rev-parse HEAD)" == "$APP_SHA" ]] || { echo 'Web checkout differs from deployed SHA' >&2; exit 3; }
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3333/api/v1/health/ready > /dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3000/health > /dev/null
RUNTIME=$(curl --fail --silent --show-error --max-time 10 http://127.0.0.1:3333/api/v1/health)
printf '%s' "$RUNTIME" | grep -Fq "\"buildSha\":\"$BACKEND_SHA\"" || { echo 'Runtime build mismatch' >&2; exit 4; }
docker compose exec -T api npx prisma migrate status
# Validate that the reviewed publisher exists in the ACTIVE production container.
docker compose exec -T api test -r /app/scripts/stage-ai-monthly-plan-versions.mjs
docker compose exec -T api test -r /app/config/commercial/iron-four-tiers-2026.candidate.json
if [[ "$MODE" == --check ]]; then
  docker compose exec -T api node scripts/stage-ai-monthly-plan-versions.mjs
  exit 0
fi
[[ "${IRON_AI_QUOTA_ROLLOUT_APPROVED:-}" == YES ]] || { echo 'Explicit rollout approval missing' >&2; exit 5; }
[[ "${IRON_AI_QUOTA_ACTOR_USER_ID:-}" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]] || {
  echo 'Valid SUPER_ADMIN actor UUID required' >&2; exit 5;
}
# The existing server backup command must succeed and its digest must verify BEFORE any entitlement write.
BKOUT=$(/opt/fm/ironfit/iron-backup.sh)
BKFILE=$(printf '%s\n' "$BKOUT" | sed -n 's/^OK \([^ ]*\) itens.*/\1/p')
[[ -n "$BKFILE" && -f "$BKFILE" && -f "$BKFILE.sha256" ]] || { echo 'Verified backup missing' >&2; exit 6; }
sha256sum -c "$BKFILE.sha256" >/dev/null || { echo 'Backup digest verification failed' >&2; exit 6; }
docker compose exec -T \
  -e IRON_AI_QUOTA_ROLLOUT_APPROVED=YES \
  -e "IRON_AI_QUOTA_ACTOR_USER_ID=$IRON_AI_QUOTA_ACTOR_USER_ID" \
  api node scripts/stage-ai-monthly-plan-versions.mjs --apply
# Independent, read-only canonical postcondition; never reassign an existing subscription.
AFTER=$(docker compose exec -T api node scripts/stage-ai-monthly-plan-versions.mjs)
printf '%s' "$AFTER" | node -e '
  let input = ""; process.stdin.on("data", c => input += c);
  process.stdin.on("end", () => {
    const r=JSON.parse(input);
    const plans=r.planVersionReadiness;
    if(r.applied!==false || r.subscriptionTransitionsApplied!==0 ||
       r.historicalPlanVersionsChanged!==0 || !Array.isArray(plans) ||
       plans.length!==4 || !plans.every(x => x.status==="CURRENT_ALREADY_COMPLIANT"))
      process.exit(7);
    console.log("IRON_FOUR_CANONICAL_TIERS_PUBLISHED_AND_VERIFIED");
  });
'
