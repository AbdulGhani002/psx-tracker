#!/usr/bin/env bash
# The company pages behind the quality figures: each run reads the 30 names
# (held and KSE-100) checked longest ago, their financials, payouts and, when
# a new report has been filed, its balance sheet. Installed at
# /root/psx-quality.sh and run by psx-quality.timer once a day, at night,
# so the whole universe turns over every four days. Credentials come from the
# app env, never this file.
#
#   /root/psx-quality.sh                             # the timer's call
#   /root/psx-quality.sh '{"max":40}'                # a bigger batch
#   /root/psx-quality.sh '{"symbols":["MUREB"]}'     # just these
set -a; . /root/psx-tracker-v2/.env.local; set +a
BODY="$1"
if [ -z "$BODY" ]; then BODY='{}'; fi
curl -s -m 900 -u "${AUTH_USERNAME}:${AUTH_PASSWORD}" -X POST -H "content-type: application/json" -d "$BODY" http://127.0.0.1:8012/api/cron/refresh-quality
echo
