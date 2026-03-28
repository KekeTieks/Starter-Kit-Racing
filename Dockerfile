# ── Stage 1: build the Vite client ───────────────────────────────────────────
FROM node:22-slim AS client-build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY index.html editor.html vite.config.js ./
COPY js/ ./js/
COPY public/ ./public/

RUN npm run build

# ── Stage 2: production server ────────────────────────────────────────────────
FROM node:22-slim AS prod

WORKDIR /app

# Server dependencies only
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Server source
COPY server/ ./server/

# Built client (dist/ → served as static files by express)
COPY --from=client-build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=2567

EXPOSE 2567

CMD ["node", "server/index.js"]
