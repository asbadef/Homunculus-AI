# Dashboard + reverse proxy. Build context is the REPOSITORY ROOT (it needs dashboard/).
#
#   docker build -t homunculus-web -f deploy/local/web/Dockerfile .

FROM node:20-alpine AS build
WORKDIR /build

COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci

COPY dashboard/ ./

# VITE_API_URL is DELIBERATELY NOT SET. With it unset, defaultBaseUrl() returns "" and the app
# talks to its own origin, which nginx proxies to the API. Setting it here would reintroduce the
# build-time address that broke the Vercel deployment.
RUN npm run build

FROM nginx:alpine
COPY --from=build /build/dist /usr/share/nginx/html
COPY deploy/local/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
