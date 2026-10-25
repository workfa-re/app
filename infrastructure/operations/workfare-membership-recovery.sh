#!/bin/sh
set -eu
umask 077

# Run on the Docker host. Credentials and signed requests stay in the app container.
# Reject overlapping old/new containers during a rollout; the next cron run retries.
container_id=$(docker ps --filter status=running --filter label=com.docker.swarm.service.name=app-apefld --format '{{.ID}}')
case "$container_id" in
  ''|*[!a-f0-9]*) echo 'Workfare membership recovery: exactly one running app container is required.' >&2; exit 1 ;;
esac
exec docker exec "$container_id" node /app/scripts/payments/recover-memberships.mjs
