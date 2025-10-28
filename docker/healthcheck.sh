#!/bin/sh

# Health check script for Docker
curl -f http://localhost:3000/health || exit 1