# Multi-stage build for production optimization
FROM node:20-alpine AS builder

# Install Python and build dependencies for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/

# Install dependencies
RUN npm install

# Copy source code
COPY frontend/ ./frontend/
COPY backend/ ./backend/

# Build frontend and backend - API polling fix
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install nginx for serving static files
RUN apk add --no-cache nginx curl

# Symlink nginx error log to stderr for docker logs visibility
RUN ln -sf /dev/stderr /var/log/nginx/error.log

WORKDIR /app

# Copy built backend
COPY --from=builder /app/backend/dist ./backend/
COPY --from=builder /app/backend/package*.json ./backend/
COPY --from=builder /app/backend/src/database ./backend/database/

# Copy built frontend
COPY --from=builder /app/frontend/dist ./frontend/

# Copy pre-built node_modules instead of reinstalling
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Setup nginx configuration
COPY docker/nginx.conf /etc/nginx/nginx.conf

# Create data directory
RUN mkdir -p /app/data

# Health check script
COPY docker/healthcheck.sh /healthcheck.sh
RUN chmod +x /healthcheck.sh

# Expose port
EXPOSE 3000

# Start script
COPY docker/start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]