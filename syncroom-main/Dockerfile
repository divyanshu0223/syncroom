# ==============================================================================
# SyncRoom - Production Multi-Stage Dockerfile
# ==============================================================================

# Stage 1: Build Frontend and Backend
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies (copy prisma schema first so postinstall prisma generate succeeds)
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --legacy-peer-deps

# Copy application sources
COPY . .

# Generate Prisma Client and run full production build (Vite client + esbuild server bundle)
RUN npx prisma generate && npm run build

# ==============================================================================
# Stage 2: Minimal Production Runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production-only dependencies
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# Copy compiled bundles and prisma from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Create dedicated non-root security user
RUN addgroup -S syncroom && adduser -S syncroom -G syncroom
USER syncroom

# Expose server port
EXPOSE 3000

# Container liveness check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Launch production server
CMD ["node", "dist/server.js"]
