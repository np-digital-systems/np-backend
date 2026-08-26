#!/bin/sh
set -e

# Apply migrations before the API starts, when asked to.
#
# Render's free tier offers neither a pre-deploy command nor a shell, so there
# is nowhere else for a deployed instance to run them. It stays opt-in because
# a schema change is not something to apply by accident: on anything with more
# than one instance, or a plan with a pre-deploy hook, migrate there instead
# and leave this unset.
#
# `migrate deploy` takes an advisory lock, so two instances starting together
# queue rather than collide.
if [ "$RUN_MIGRATIONS_ON_BOOT" = "true" ]; then
  echo "Applying database migrations..."
  node_modules/.bin/prisma migrate deploy
fi

exec "$@"
