FROM node:22-alpine
RUN apk add --no-cache openssl

WORKDIR /app

# The repo is an npm workspace (app + extensions), so install from the full source tree.
COPY . .
RUN npm ci --no-audit --no-fund \
 && npm run build \
 && npm prune --omit=dev \
 && npm cache clean --force

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# setup = prisma generate + migrate deploy (creates/updates the SQLite DB on the volume)
CMD ["npm", "run", "docker-start"]
