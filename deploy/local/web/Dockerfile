# Dashboard + reverse proxy. Build context is the REPOSITORY ROOT (it needs dashboard/).
#
#   docker build -t homunculus-web -f deploy/local/web/Dockerfile .

FROM node:20-alpine AS build
WORKDIR /build

COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci

COPY dashboard/ ./

# Vite auto-loads .env.production during `npm run build`. That file exists to point the CLOUD build
# at Render; inside this image it would bake an internet host into a dashboard that must talk to the
# API beside it — and it would do so silently, because the page still renders. Removed here as well
# as in .dockerignore: the failure is invisible and the consequence is clinical traffic leaving the
# hospital, so one safeguard is not enough.
RUN rm -f .env .env.local .env.production .env.production.local

# VITE_API_URL is DELIBERATELY NOT SET. With it unset, defaultBaseUrl() returns "" and the app
# talks to its own origin, which nginx proxies to the API. Setting it here would reintroduce the
# build-time address that broke the Vercel deployment.
#
# BUILD_SHA: the commit this image is built from, for the account menu's version line. The context
# has no .git and this image has no git, so vite.config.js cannot ask; the deploy passes it in:
#   BUILD_SHA=$(git rev-parse --short HEAD) docker compose build web
# Unset, the dashboard says "version unknown" rather than invent one. Declared here, after npm ci,
# so a new SHA does not throw away the cached dependencies. An ARG is in the environment of the RUN
# below, which is how `npm run build` (vite.config.js, gitSha) sees it.
ARG BUILD_SHA
RUN npm run build

# Fail the build rather than ship a dashboard pointed at someone else's server.
RUN if grep -rq "onrender.com" dist/assets/*.js; then \
      echo "HATA: bundle harici API adresi iceriyor — .env dosyalari derleme oncesi temizlenmemis" >&2; \
      exit 1; \
    fi

FROM nginx:alpine
# openssl: the entrypoint script below mints a self-signed certificate on first start, because
# Chrome disables the Notification API on plain-HTTP origins and the ward needs those alarms.
RUN apk add --no-cache openssl
COPY --from=build /build/dist /usr/share/nginx/html
COPY deploy/local/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/local/web/10-selfsigned-cert.sh /docker-entrypoint.d/10-selfsigned-cert.sh
RUN chmod +x /docker-entrypoint.d/10-selfsigned-cert.sh
EXPOSE 80 443
