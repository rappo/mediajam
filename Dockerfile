FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim

WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules

RUN mkdir -p /app/data

ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/data/mediajam.sqlite

EXPOSE 3000

CMD ["node", "build/index.js"]
