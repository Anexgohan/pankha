# Multi-stage build for production optimization
FROM node:20-alpine AS builder

# Version injected at build time via CI/CD
ARG VERSION=dev
ENV VITE_APP_VERSION=$VERSION

# Install Python and build dependencies for native modules
RUN apk add --no-cache python3 make g++

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

# Production stage
FROM node:20-alpine AS production

# Pass version to runtime for backend health endpoint
ARG VERSION=dev
ENV PANKHA_VERSION=$VERSION

# Runtime dependencies and directory setup
RUN apk add --no-cache nginx curl && \
    ln -sf /dev/stderr /var/log/nginx/error.log && \
    mkdir -p /app/data /app/backend/data/updates /frontend/src/config

WORKDIR /app

# Copy built backend
COPY --from=builder /app/backend/dist ./backend/
COPY --from=builder /app/backend/package*.json ./backend/
COPY --from=builder /app/backend/src/database ./backend/database/
COPY --from=builder /app/backend/src/config ./backend/config/
# SST: Copy frontend ui-options.json to path where compiled backend expects it
# The compiled JS at /app/backend/config/uiOptions.js imports '../../../frontend/src/config/ui-options.json'
# Path resolution: /app/backend/config/ -> ../../.. -> /  -> /frontend/src/config/
COPY --from=builder /app/frontend/src/config/ui-options.json /frontend/src/config/

# Copy built frontend
COPY --from=builder /app/frontend/dist ./frontend/

# Copy pre-built node_modules instead of reinstalling
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Setup nginx configuration
COPY docker/nginx.conf /etc/nginx/nginx.conf

# Copy and setup startup scripts
COPY docker/healthcheck.sh /healthcheck.sh
COPY docker/start.sh /start.sh
RUN chmod +x /healthcheck.sh /start.sh

EXPOSE 3000

CMD ["/start.sh"]