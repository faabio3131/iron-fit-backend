#!/bin/bash
# Deploy do Iron por "puxada" do GitHub: so implanta o que estiver na branch `production` de cada repositorio.
# Uso: deploy.sh            -> implanta se houver mudanca
#      deploy.sh --check    -> so mostra o que seria feito
#      deploy.sh status     -> mostra o que esta implantado
cd /opt/fm/ironfit || exit 1
set -u
set -o pipefail
BACK_REF=${BACKEND_REF:-production}
APP_REF=${APP_REF:-production}
STATE=/opt/fm/ironfit/.deployed
MODE=${1:-run}
log(){ echo "$(date -u +%FT%TZ) $*"; }
. /opt/fm/ironfit/deploy-lib.sh
FAILED=/opt/fm/ironfit/.failed-sha

[ -f "$STATE" ] || { echo "BACKEND_SHA=$(git -C src/backend rev-parse HEAD)" > "$STATE"; echo "APP_SHA=$(git -C src/app rev-parse HEAD)" >> "$STATE"; }
# shellcheck disable=SC1090
. "$STATE"
if [ "$MODE" = status ]; then echo "backend=$BACKEND_SHA"; echo "app=$APP_SHA"; exit 0; fi

resolve(){ # $1=dir $2=ref -> imprime SHA da ref remota ou vazio
  git -C "$1" ls-remote origin "refs/heads/$2" "$2" 2>/dev/null | head -1 | cut -f1
}
case "$BACK_REF" in refs/*) BR_FETCH=$BACK_REF;; *) BR_FETCH=refs/heads/$BACK_REF;; esac
case "$APP_REF"  in refs/*) AR_FETCH=$APP_REF;;  *) AR_FETCH=refs/heads/$APP_REF;;  esac
NB=$(git -C src/backend ls-remote origin "$BR_FETCH" | head -1 | cut -f1)
NA=$(git -C src/app ls-remote origin "$AR_FETCH" | head -1 | cut -f1)
[ -n "$NB" ] && [ -n "$NA" ] || { [ "$MODE" = "--check" ] && echo "branch/ref ainda nao existe (backend='${NB:-nao}' app='${NA:-nao}')"; exit 0; }
CHB=0; CHA=0
[ "$NB" != "$BACKEND_SHA" ] && CHB=1
[ "$NA" != "$APP_SHA" ] && CHA=1
if [ $CHB = 0 ] && [ $CHA = 0 ]; then [ "$MODE" = "--check" ] && echo "sem mudancas (backend=${BACKEND_SHA:0:7} app=${APP_SHA:0:7})"; exit 0; fi
if [ "$MODE" = "--check" ]; then echo "MUDARIA: backend ${BACKEND_SHA:0:7} -> ${NB:0:7} ; app ${APP_SHA:0:7} -> ${NA:0:7}"; exit 0; fi
# Nao repete um deploy que ja falhou para este mesmo par de commits.
[ "$(cat "$FAILED" 2>/dev/null)" = "$NB:$NA" ] && exit 0

log "== DEPLOY inicio backend:${BACKEND_SHA:0:7}->${NB:0:7} app:${APP_SHA:0:7}->${NA:0:7}"
git -C src/backend fetch -q origin "$BR_FETCH" 2>/dev/null; git -C src/app fetch -q origin "$AR_FETCH" 2>/dev/null
# Somente avancos (fast-forward): recusa historia reescrita ou divergente
for pair in "backend:$BACKEND_SHA:$NB" "app:$APP_SHA:$NA"; do
  IFS=: read -r d old new <<< "$pair"; dir=src/$d
  if [ "$old" != "$new" ] && ! git -C "$dir" merge-base --is-ancestor "$old" "$new" 2>/dev/null; then
    log "RECUSADO: $d $new nao descende do implantado $old (historia reescrita). Nada foi alterado."; exit 2
  fi
done
if [ $CHB = 1 ]; then
  if ! SCAN=$(scan_destructive src/backend "$BACKEND_SHA" "$NB"); then
    log "RECUSADO: $SCAN. Exige aprovacao manual; nada foi alterado."; echo "$NB:$NA" > "$FAILED"; exit 4
  fi
fi
MIGRATED=0
log "backup do banco"; BKOUT=$(/opt/fm/ironfit/iron-backup.sh) || { log "FALHA no backup, abortando"; exit 3; }
BKFILE=$(echo "$BKOUT" | sed -n 's/^OK \([^ ]*\) itens.*/\1/p')
[ -f "$BKFILE" ] && sha256sum -c "$BKFILE.sha256" >/dev/null 2>&1 || { log "backup nao verificado, abortando"; exit 3; }
log "backup verificado: $BKFILE"
[ $CHB = 1 ] && docker tag ironfit-api:ensaio ironfit-api:prev
[ $CHA = 1 ] && docker tag ironfit-web:ensaio ironfit-web:prev
if [ $CHB = 1 ]; then git -C src/backend checkout -q --detach "$NB"; fi
if [ $CHA = 1 ]; then git -C src/app checkout -q --detach "$NA"; fi
OLDENV=$(mktemp); cp -p .env "$OLDENV"
sed -i "s#^IRON_BUILD_SHA=.*#IRON_BUILD_SHA=$NB#; s#^IRON_RELEASE_VERSION=.*#IRON_RELEASE_VERSION=prod-${NB:0:7}-${NA:0:7}#" .env
rollback(){
  log "ROLLBACK: $1"
  echo "$NB:$NA" > "$FAILED"
  if [ "$MIGRATED" = 1 ]; then
    log "migracao aplicada ou tentada: restaurando o banco do backup verificado"
    docker compose stop api >/dev/null 2>&1
    db_restore "$BKFILE" || log "ALERTA: restauracao automatica FALHOU; intervencao manual com o backup $BKFILE"
  fi
  [ $CHB = 1 ] && docker tag ironfit-api:prev ironfit-api:ensaio && git -C src/backend checkout -q --detach "$BACKEND_SHA"
  [ $CHA = 1 ] && docker tag ironfit-web:prev ironfit-web:ensaio && git -C src/app checkout -q --detach "$APP_SHA"
  cp -p "$OLDENV" .env; docker compose up -d api web >/dev/null 2>&1
  log "ROLLBACK concluido. Se migrations rodaram, restaurar banco do backup mais recente se necessario."; rm -f "$OLDENV"; exit 1
}
if [ $CHB = 1 ]; then log "build api"; docker compose build api 2>&1 | tail -n 2 || rollback "build api"; fi
if [ $CHA = 1 ]; then log "build web"; docker compose build web 2>&1 | tail -n 2 || rollback "build web"; fi
if [ $CHB = 1 ]; then
  log "migrations"
  MOUT=$(docker compose run --rm --no-deps -T api npx prisma migrate deploy < /dev/null 2>&1); MRC=$?
  echo "$MOUT" | tail -n 4
  echo "$MOUT" | grep -q "No pending migrations" || MIGRATED=1
  [ "$MRC" = 0 ] || rollback "migrations falharam"
fi
log "subindo"; docker compose up -d api web 2>&1 | tail -n 3 || rollback "docker compose up falhou"
ok=0
for i in $(seq 1 30); do
  A=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3333/api/v1/health/ready); W=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health)
  [ "$A" = 200 ] && [ "$W" = 200 ] && { ok=1; break; }; sleep 4
done
[ $ok = 1 ] || rollback "saude falhou (api=$A web=$W)"
# Healthy old containers must not satisfy a failed deployment.
for service in api web; do
  actual=$(docker inspect "ironfit-${service}-1" --format '{{.Image}}' 2>/dev/null) || rollback "container $service nao encontrado"
  expected=$(docker image inspect "ironfit-${service}:ensaio" --format '{{.Id}}' 2>/dev/null) || rollback "imagem $service nao encontrada"
  [ -n "$actual" ] && [ "$actual" = "$expected" ] || rollback "imagem ativa $service divergiu do build"
done
RUNTIME=$(curl -fsS --max-time 8 http://127.0.0.1:3333/api/v1/health) || rollback "API health indisponivel"
echo "$RUNTIME" | grep -Fq "\"buildSha\":\"$NB\"" || rollback "API buildSha nao corresponde ao release"
printf 'BACKEND_SHA=%s\nAPP_SHA=%s\n' "$NB" "$NA" > "$STATE"; rm -f "$FAILED"
docker image prune -f >/dev/null 2>&1; rm -f "$OLDENV"
log "== DEPLOY OK backend=${NB:0:7} app=${NA:0:7}"
