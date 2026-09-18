#!/usr/bin/env bash
# The exchange's company-announcements board, read every five minutes, and
# the documents of held names sent to Telegram and email. Installed at
# /root/psx-announcements.sh on the server and run by psx-announcements.timer.
# Credentials come from the app env, never this file.
#
#   /root/psx-announcements.sh                        # the timer's call
#   /root/psx-announcements.sh '{"dryRun":true}'      # what would go out, nothing sent
#   /root/psx-announcements.sh '{"backfill":true}'    # also pull each held name's recent board
#   /root/psx-announcements.sh '{"sinceHours":6}'     # a narrower window
set -a; . /root/psx-tracker-v2/.env.local; set +a
BODY="$1"
if [ -z "$BODY" ]; then BODY='{}'; fi
curl -s -m 270 -u "${AUTH_USERNAME}:${AUTH_PASSWORD}" -X POST -H "content-type: application/json" -d "$BODY" http://127.0.0.1:8012/api/cron/announcements
echo
