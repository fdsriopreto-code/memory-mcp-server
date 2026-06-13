FROM node:22-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY server/package.json ./
RUN npm install
COPY server/ .
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY server/package.json ./

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
