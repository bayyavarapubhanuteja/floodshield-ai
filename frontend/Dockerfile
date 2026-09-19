# FloodShield AI — React + Vite frontend served by nginx
# ---------- build stage ----------
FROM node:20-alpine AS build

# Empty => the SPA calls relative /api/... which nginx proxies to the backend service.
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}

# Install dependencies in a separate directory so a host node_modules/ copied with the
# build context (e.g. macOS-native esbuild/rollup binaries) can never shadow them.
WORKDIR /deps
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

WORKDIR /app
COPY . .
RUN rm -rf node_modules dist \
    && mv /deps/node_modules ./node_modules \
    && npm run build

# ---------- runtime stage ----------
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
