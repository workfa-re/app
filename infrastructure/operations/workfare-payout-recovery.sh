#!/bin/sh
set -eu

# Run on the production Docker host. Credentials remain inside the app container.
container_id=$(docker ps --filter label=com.docker.swarm.service.name=app-apefld --format '{{.ID}}' | head -n 1)
case "$container_id" in
  ''|*[!a-f0-9]*) echo 'Workfare app container unavailable.' >&2; exit 1 ;;
esac
exec docker exec "$container_id" node /app/scripts/payments/recover-recipient-payouts.mjs
