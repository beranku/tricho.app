FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs meta.mjs routes.mjs jwt.mjs ./
COPY providers ./providers
USER node
EXPOSE 4545
CMD ["node", "server.mjs"]
