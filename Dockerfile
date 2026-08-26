# owainlewis/awesome-artificial-intelligence @ ab1c3cceef8ab906586505a7a7a293f434280862
# TypeScript port. MIT.
#
# Mirrors the Python test image so the two can be compared like for like. That
# image was python:3.13-slim plus git and nothing else -- the project declares
# no third-party dependencies -- so this one is node:22 plus git, with the
# dependency tree carrying only the TypeScript toolchain.
#
# Build context must be this directory.

FROM node:22-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Dependency layer first, so edits to sources do not re-resolve the tree.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run typecheck && npm run build

# Test stage: keeps devDependencies (vitest) and the repository content, because
# `validate_readme` reads README.md and the churn check shells out to git.
FROM builder AS test
CMD ["npx", "vitest", "run", "--reporter=verbose"]

# Runtime stage: the validator as a CLI, the way CI invokes it.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist
# The validator resolves its README argument relative to the working directory,
# so the curated content has to ship beside the compiled script.
COPY README.md ./README.md

ENTRYPOINT ["node", "/app/dist/scripts/validate_readme.js"]
CMD ["README.md"]
