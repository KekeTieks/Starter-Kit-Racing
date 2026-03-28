FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server dependencies first (better layer caching)
COPY server/package.json server/package.json
RUN cd server && npm install --omit=dev

# Copy everything else
COPY . .

EXPOSE 2567

CMD ["node", "server/index.js"]
