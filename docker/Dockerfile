# Multi-stage build for production optimization
FROM node:20-alpine AS builder

# Version injected at build time via CI/CD
ARG VERSION=dev
ENV VITE_APP_VERSION=$VERSION

# Native build toolchain (python3/make/g++) intentionally omitted: no dependency
# compiles native code (verified - zero gyp/install scripts; rollup/esbuild ship
# prebuilt musl binaries for both x64 and arm64). Re-add the following line only
# if a future npm dependency fails `npm ci` with a node-gyp / "python3 not found" error:
#   RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

# Install dependencies (npm ci is faster and deterministic)
# RUN npm install
RUN npm ci

# Copy source code
COPY frontend/ ./frontend/
COPY backend/ ./backend/

# Build frontend and backend - API polling fix
RUN npm run build

# Production dependencies stage: install ONLY the backend's runtime dependencies.
# All three workspace manifests are copied so npm can validate the lockfile, but
# `--workspace=backend --omit=dev` installs just the backend's prod deps (~9MB)
# instead of shipping the full ~250MB dev+frontend tree into the runtime image.
FROM node:20-alpine AS prod-deps

WORKDIR /app

COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/
RUN npm ci --omit=dev --workspace=backend

# Production stage
FROM node:20-alpine AS production

# Pass version to runtime for backend health endpoint
ARG VERSION=dev
ENV PANKHA_VERSION=$VERSION

# No runtime apk packages needed: the container healthcheck uses BusyBox `wget`
# (bundled in the Alpine base), so curl is intentionally not installed.

WORKDIR /app

# Copy built backend
COPY --from=builder /app/backend/dist ./backend/
COPY --from=builder /app/backend/package*.json ./backend/
COPY --from=builder /app/backend/src/database ./backend/database/
COPY --from=builder /app/backend/src/config ./backend/config/
COPY --from=builder /app/backend/profiles ./backend/profiles/
# SST: Copy frontend ui-options.json to path where compiled backend expects it
# The compiled JS at /app/backend/config/uiOptions.js imports '../../../frontend/src/config/ui-options.json'
# Path resolution: /app/backend/config/ -> ../../.. -> /  -> /frontend/src/config/
COPY --from=builder /app/frontend/src/config/ui-options.json /frontend/src/config/

# Copy built frontend
COPY --from=builder /app/frontend/dist ./frontend/

# Copy backend-only production node_modules from the prod-deps stage (~9MB vs ~250MB)
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy and setup startup scripts
COPY docker/healthcheck.sh /healthcheck.sh
COPY docker/start.sh /start.sh
RUN chmod +x /healthcheck.sh /start.sh

EXPOSE 3143

CMD ["/start.sh"]