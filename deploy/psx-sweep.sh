#!/usr/bin/env bash
# One tick of the day's read of the exchange's site (lib/prices/sweep): at
# most one page, when its random time has come. Installed at
# /root/psx-sweep.sh on the server and run by psx-sweep.timer. Credentials
# come from the app env, never this file.
#
#   /root/psx-sweep.sh                     # the timer's call
#   /root/psx-sweep.sh '{"status":true}'   # where it stands, reading nothing
set -a; . /root/psx-tracker-v2/.env.local; set +a
BODY="$1"
if [ -z "$BODY" ]; then BODY='{}'; fi
curl -s -m 270 -u "${AUTH_USERNAME}:${AUTH_PASSWORD}" -X POST -H "content-type: application/json" -d "$BODY" http://127.0.0.1:8012/api/cron/dps-sweep
echo
