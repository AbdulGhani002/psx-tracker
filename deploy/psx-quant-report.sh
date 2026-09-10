#!/usr/bin/env bash
# Daily charts + model report to Telegram, after the PSX close. Installed at
# /root/psx-quant-report.sh on the server and run by psx-quant-report.timer
# (Mon..Fri 14:45 CEST). Credentials come from the app env, never this file.
#
#   /root/psx-quant-report.sh                       # the timer's call: dedupes per day
#   /root/psx-quant-report.sh '{"force":true}'      # send again today
#   /root/psx-quant-report.sh '{"dryRun":true,"userId":"..."}'   # text only, nothing sent
#
# The body default is assigned on its own line on purpose: "${1:-{}}" lets
# the shell close the expansion at the first brace and appends a stray "}",
# which made every forced resend arrive as invalid JSON and fall back to a
# deduped plain run.
set -a; . /root/psx-tracker-v2/.env.local; set +a
BODY="$1"
if [ -z "$BODY" ]; then BODY='{}'; fi
curl -s -m 290 -u "${AUTH_USERNAME}:${AUTH_PASSWORD}" -X POST -H "content-type: application/json" -d "$BODY" http://127.0.0.1:8012/api/cron/quant-report
echo
