#!/bin/sh

# Health check script for Docker
# Talks to the internal PORT the app listens on (default 3143)
wget -q -O /dev/null "http://localhost:${PORT:-3143}/health" || exit 1