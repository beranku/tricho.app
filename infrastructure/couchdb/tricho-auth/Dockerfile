FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server.mjs meta.mjs routes.mjs jwt.mjs env-guard.mjs ./
COPY providers ./providers
COPY billing ./billing
COPY scripts ./scripts
# Pre-create the shared-JWT mountpoint and the dev key dir with the `node`
# user owning them. Docker's named-volume init preserves this ownership on
# first creation, so we can drop to an unprivileged user while still writing
# the JWT public key into the shared volume.
RUN mkdir -p /shared/jwt /var/lib/tricho-auth \
 && chown -R node:node /shared /var/lib/tricho-auth
USER node
EXPOSE 4545
CMD ["node", "server.mjs"]
