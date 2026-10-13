# syntax=docker/dockerfile:1

### Client: build the Angular app into server/public
FROM node:24-alpine AS client
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY angular.json tsconfig.json tsconfig.app.json tsconfig.spec.json .postcssrc.json ./
COPY public ./public
COPY src ./src
RUN npx ng build

### Server: production dependencies only
FROM node:24-alpine AS server-deps
WORKDIR /deps
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

### Runtime
FROM node:24-alpine
ENV NODE_ENV=production \
	PORT=80 \
	DATA_DIR=/home/burnit/data
WORKDIR /home/burnit
COPY --from=server-deps /deps/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY --from=client /build/server/public ./public
RUN mkdir -p data && chown node:node data
USER node
VOLUME /home/burnit/data
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "src/index.js"]
