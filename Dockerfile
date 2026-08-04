# Node runs the TypeScript sources directly by stripping types, so there is no
# compile stage here. The only thing worth splitting out is dependency
# installation, which keeps npm's cache and the dev dependencies out of the
# final image.
FROM node:24-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev


FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src

# The image ships with this user already created. Running as root is the
# default nobody asks for and everybody inherits.
USER node

EXPOSE 3000

# Liveness, not readiness: this has to keep passing while the process drains,
# or the container gets restarted in the middle of an orderly shutdown.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --spider "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# Exec form, so node is PID 1 and receives SIGTERM directly instead of having
# it swallowed by a shell.
CMD ["node", "src/main.ts"]
