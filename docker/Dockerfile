# Node Alpine -- multi-arch (amd64 + arm64)
FROM oven/bun:1.3.11-alpine AS builder

WORKDIR /app

# Install system dependencies required for Bun
RUN apk add --no-cache wget curl bash

# Accept build arguments for environment variables
ARG AUTH_ENABLED
ARG AUTH_SECRET
ARG POCKETBASE_URL
ARG SESSION_MAX_AGE

# Copy package files first for caching
COPY package.json bun.lock ./

# Install dependencies (Node)
RUN bun install

# Copy the rest of the project
COPY . .

# Build the project
RUN bun run build

# Serve with nginx
FROM nginx:1.28.2-alpine

# njs powers the /proxy/ pass-through location in nginx.conf.
RUN apk add --no-cache nginx-module-njs \
    && sed -i '1i load_module modules/ngx_http_js_module.so;' /etc/nginx/nginx.conf

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/njs/monochrome-proxy.js /etc/nginx/njs/monochrome-proxy.js

# Expose the nginx port
EXPOSE 4173

CMD ["nginx", "-g", "daemon off;"]
