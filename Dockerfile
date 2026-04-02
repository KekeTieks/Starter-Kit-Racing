# ── Stage 1: build the Vite client ───────────────────────────────────────────
FROM node:22-slim AS client-build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY index.html editor.html vite.config.js ./
COPY js/ ./js/
COPY shared/ ./shared/
COPY public/ ./public/

RUN npm run build

# ── Stage 2: production server ────────────────────────────────────────────────
FROM node:22-slim AS prod

WORKDIR /app

# Server dependencies only
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Server source + shared modules
COPY server/ ./server/
COPY shared/ ./shared/

# Symlink node_modules so shared/ can resolve crashcat from server deps
RUN ln -s /app/server/node_modules /app/shared/node_modules

# Built client (dist/ → served as static files by express)
COPY --from=client-build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=2567

EXPOSE 2567

CMD ["node", "server/index.js"]
