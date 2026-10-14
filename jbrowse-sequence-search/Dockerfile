# syntax=docker/dockerfile:1
FROM node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436
WORKDIR /app
ENV TMPDIR=/app/.tmp
RUN mkdir -p /app/.tmp
COPY package.json package-lock.json ./
# Optional: behind a TLS-intercepting proxy, pass its CA bundle with
#   --secret id=extra_ca,src=/path/to/ca.pem
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund
COPY . .
CMD ["sh", "-c", "npm run lint && npm test && npm run build && npm run check:releases"]
