#!/bin/sh

# Start nginx in background
nginx &

# Start backend server
cd /app/backend
npm start