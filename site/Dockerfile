# syntax=docker/dockerfile:1
# Builds the combined plugin site (the same layout GitHub Pages serves) and
# serves it with nginx under /web-plugins/. Build context: the repository root.
# Used by site/compose.yaml; see site/README.md.

FROM node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build
WORKDIR /src
COPY trello-check-date/package.json trello-check-date/package-lock.json trello-check-date/
# Optional: behind a TLS-intercepting proxy, pass its CA bundle with
#   --secret id=extra_ca,src=/path/to/ca.pem
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    cd trello-check-date && npm ci --no-audit --no-fund
COPY trello-check-date/ trello-check-date/
COPY jbrowse-sequence-search/releases/ jbrowse-sequence-search/releases/
COPY site/stage-site.sh site/
# The Trello Power-Up's public API key (not a secret, never a user token).
# The default is a placeholder: the site builds and serves, but Trello
# authorization only works with your real key.
ARG TRELLO_APP_KEY=00000000000000000000000000000000
RUN cd trello-check-date && TRELLO_APP_KEY="$TRELLO_APP_KEY" npm run config && npm run build
RUN sh site/stage-site.sh trello-check-date/dist /site

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10
# The official image renders /etc/nginx/templates/*.template with the
# container's environment at start-up, so the listen port is configurable.
ENV PLUGIN_SITE_CONTAINER_PORT=8080
COPY site/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /site /usr/share/nginx/html/web-plugins
EXPOSE 8080
