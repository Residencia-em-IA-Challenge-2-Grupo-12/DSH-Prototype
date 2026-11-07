#!/usr/bin/env bash
set -euo pipefail
project="study-domain-test-$(date +%s)-$$"
port="${DOMAIN_TEST_PORT:-4196}"
DOMAIN_PROBE_PORT="$port" node -e 'const net=require("node:net"); const p=Number(process.env.DOMAIN_PROBE_PORT); if(!Number.isInteger(p)||p<1||p>65535)process.exit(2);const s=net.createServer();s.on("error",()=>{console.error("Test port is unavailable");process.exit(1)});s.listen(p,"127.0.0.1",()=>s.close())'
cleanup() {
  local result=$?
  trap - EXIT
  if ! DOMAIN_PORT="$port" docker compose -p "$project" -f compose.domain.yaml down --volumes --rmi local --remove-orphans >/dev/null 2>&1; then
    printf '%s\n' "Cleanup failed for disposable project $project; inspect its Docker resources." >&2
    result=1
  fi
  exit "$result"
}
trap cleanup EXIT
compose() { DOMAIN_PORT="$port" docker compose -p "$project" -f compose.domain.yaml "$@"; }
http() { curl --silent --fail --connect-timeout 1 --max-time 3 "$@"; }
wait_ready() {
  for _ in $(seq 1 50); do
    if http "http://127.0.0.1:$port/health" >/dev/null; then return; fi
    sleep .2
  done
  printf '%s\n' 'Service did not become ready.' >&2
  return 1
}
assert_own_container_running() {
  local id
  id="$(compose ps --quiet domain)"
  [[ -n "$id" ]]
  [[ "$(docker inspect --format '{{.State.Running}}' "$id")" == true ]]
}
compose up --build --detach >/dev/null
wait_ready
assert_own_container_running
http "http://127.0.0.1:$port/health" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{const x=JSON.parse(s);if(x.status!=="ok"||x.calendarWrites!==false)process.exit(1)})'
http -H 'content-type: application/json' -d '{"expectedVersion":0,"payload":{"fictional":true}}' "http://127.0.0.1:$port/v1/students/synthetic/revisions/context" >/dev/null
compose down >/dev/null
compose up --no-build --detach >/dev/null
wait_ready
assert_own_container_running
http "http://127.0.0.1:$port/v1/students/synthetic/versions" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{if(JSON.parse(s).context!==1)process.exit(1)})'
id="$(compose ps --quiet domain)"
docker inspect "$id" | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{let i=JSON.parse(s)[0];if(i.HostConfig.NetworkMode!=="host"||!i.HostConfig.ReadonlyRootfs||i.Config.User!=="1000:1000")process.exit(1)})'
printf '%s\n' 'Container started on loopback; synthetic state persisted across recreation; isolation settings inspected.'
