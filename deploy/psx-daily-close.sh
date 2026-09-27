#!/usr/bin/env bash
# The evening after the close: the exchange's end-of-day file into the stored
# price series, then each user's model reading and swing book. Installed at
# /root/psx-daily-close.sh and run by psx-daily-close.timer (Mon..Fri 14:15 and
# 16:30 server time, i.e. 17:15 and 19:30 in Karachi in summer). The second run
# only does work if the first missed the file. Credentials come from the app
# env, never this file.
#
#   /root/psx-daily-close.sh                          # the timer's call
#   /root/psx-daily-close.sh '{"force":true}'         # rebuild every user anyway
#   /root/psx-daily-close.sh '{"from":"2026-09-23"}'  # fetch every day's file from a date
set -a; . /root/psx-tracker-v2/.env.local; set +a
BODY="$1"
if [ -z "$BODY" ]; then BODY='{}'; fi
curl -s -m 900 -u "${AUTH_USERNAME}:${AUTH_PASSWORD}" -X POST -H "content-type: application/json" -d "$BODY" http://127.0.0.1:8012/api/cron/daily-close
echo
