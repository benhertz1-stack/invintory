# Build stage
FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine
WORKDIR /app

# Fonts so sharp/librsvg can rasterise text in the fridge renders
RUN apk add --no-cache fontconfig ttf-dejavu

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/server/data ./server/data

EXPOSE 8080
CMD ["node", "dist-server/index.js"]
