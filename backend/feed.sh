#!/usr/bin/env bash
# The recorder's jobs, run by the public feed repository's workflow (cowboy-feed), which checks out
# this repository's code and its data branch. Same jobs and order as .github/workflows/record.yml.
# The feed's run log is public: the jobs' own output goes to $FEED_LOG, and the public log shows
# one line per job and, when a job fails, only the error's last line.
#
#   STORE=../store bash feed.sh due     report what is due (outputs for the workflow, no network)
#   STORE=../store SITE=../site bash feed.sh run
#       run what is due (DUE, SIGNALS_DUE, HISTORY_DUE, FLOW_DUE from the due step; FORCE=true
#       rebuilds the app files even when nothing is due), commit the data branch, and report
#       publish=true when the app files are ready to publish.
set -uo pipefail
cd "$(dirname "$0")"
: "${STORE:?}"
LOG=${FEED_LOG:-/tmp/feed.log}
OUT=${GITHUB_OUTPUT:-/dev/null}
failed=0

step() {  # step NAME [soft] COMMAND...
  local name=$1 soft=0; shift
  if [ "${1:-}" = soft ]; then soft=1; shift; fi
  : >"$LOG.step"
  if "$@" >"$LOG.step" 2>&1; then
    echo "$name: ok"; cat "$LOG.step" >>"$LOG"; return 0
  fi
  cat "$LOG.step" >>"$LOG"
  echo "$name: failed ($(last_error))"
  [ $soft = 1 ] || failed=1
  return 1
}
# The error's last line, never source code (tracebacks quote this repository's code).
last_error() { grep -v '^    ' "$LOG.step" | grep -v '^Traceback' | tail -n 1; }

case "${1:-}" in
  due)
    due_out=$(mktemp) || exit 1
    trap 'rm -f "$due_out"' EXIT
    for check in record signal history flow; do
      step "$check due" env GITHUB_OUTPUT="$due_out" python3 "${check}_once.py" --out "$STORE" --due || :
    done
    for key in due signals_due history_due flow_due; do
      if [ "$(grep -Ec "^${key}=(true|false)$" "$due_out")" != 1 ]; then
        echo "$key: missing or invalid result"
        failed=1
      fi
    done
    [ "$failed" = 0 ] || exit 1
    cat "$due_out" >>"$OUT"
    tr '\n' ' ' <"$due_out"; echo
    ;;
  run)
    : "${SITE:?}"
    DUE=${DUE:-false} SIGNALS_DUE=${SIGNALS_DUE:-false} HISTORY_DUE=${HISTORY_DUE:-false} FLOW_DUE=${FLOW_DUE:-false} FORCE=${FORCE:-false}
    anything=false
    for v in "$DUE" "$SIGNALS_DUE" "$HISTORY_DUE" "$FLOW_DUE" "$FORCE"; do [ "$v" = true ] && anything=true; done
    if [ $anything != true ]; then
      echo "nothing due"
      step health python3 check_health.py "$SITE/health.json"
      exit $failed
    fi

    [ "$DUE" = true ] && step record python record_once.py --out "$STORE" --site "$SITE"
    if [ "$FLOW_DUE" = true ]; then
      step flow python flow_once.py --out "$STORE" --budget 120 --max-intervals 8
      step wallets soft python wallet_alias_once.py --out "$STORE" --days 30 --budget 60
    fi
    [ "$SIGNALS_DUE" = true ] && step signals python signal_once.py --out "$STORE"
    if [ "$DUE" = true ] || [ "$HISTORY_DUE" = true ]; then
      step history python history_once.py --out "$STORE" --budget 150
    fi

    built=false committed=false
    step publish python publish_site.py --data "$STORE" --site "$SITE" && built=true
    if [ $built = true ]; then step health python3 check_health.py "$SITE/health.json"; fi
    commit() (
      cd "$STORE" || return 1
      git add -A
      git diff --cached --quiet && return 0
      git -c user.name="github-actions[bot]" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
        commit -qm "record $(date -u +%Y-%m-%dT%H:%MZ)" && git push -q origin HEAD:data
    )
    step commit commit && committed=true
    if [ $built = true ] && [ $committed = true ]; then echo "publish=true" >>"$OUT"; fi
    exit $failed
    ;;
  *) echo "usage: feed.sh due|run" >&2; exit 2 ;;
esac
