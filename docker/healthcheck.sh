#!/bin/sh

# Health check script for Docker
# Always talks to the standardized internal port 3143
curl -f http://localhost:3143/health || exit 1