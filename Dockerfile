# The web app, built standalone so the image carries the server Next traced rather
# than the whole of node_modules.
#
# NEXT_PUBLIC_* values are compiled into the bundle, so they are build arguments:
# moving the API to another address means building again, not restarting.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_SCRY_API_URL
ARG NEXT_PUBLIC_SCRY_WS_URL
ARG NEXT_PUBLIC_SCRY_HLS_BASE_URL
ENV NEXT_PUBLIC_SCRY_API_URL=$NEXT_PUBLIC_SCRY_API_URL \
    NEXT_PUBLIC_SCRY_WS_URL=$NEXT_PUBLIC_SCRY_WS_URL \
    NEXT_PUBLIC_SCRY_HLS_BASE_URL=$NEXT_PUBLIC_SCRY_HLS_BASE_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
