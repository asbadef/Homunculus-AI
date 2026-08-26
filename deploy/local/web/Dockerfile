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
RUN npm run build

# Fail the build rather than ship a dashboard pointed at someone else's server.
RUN if grep -rq "onrender.com" dist/assets/*.js; then \
      echo "HATA: bundle harici API adresi iceriyor — .env dosyalari derleme oncesi temizlenmemis" >&2; \
      exit 1; \
    fi

FROM nginx:alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY deploy/local/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
