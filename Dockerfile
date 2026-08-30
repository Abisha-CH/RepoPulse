# ---- Build stage -----------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

# Install workspace manifests first for Docker layer caching.
COPY package.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm install

# Copy the full source (see .dockerignore).
COPY . .

# Generate the Prisma client, then build both workspaces.
RUN npm run db:generate -w backend
RUN npm run build -w frontend
RUN npm run build -w backend

# ---- Runtime stage ---------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000

# node_modules is copied whole (dev deps included) so the Prisma CLI is present
# at runtime for `prisma migrate deploy`.
COPY --from=builder /app/package.json ./
COPY --from=builder /app/backend/package.json backend/package.json
COPY --from=builder /app/frontend/package.json frontend/package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist backend/dist
COPY --from=builder /app/backend/prisma backend/prisma
COPY --from=builder /app/frontend/dist frontend/dist

EXPOSE 3000

# Apply migrations, then boot the API (which also serves the built frontend).
CMD ["sh", "-c", "npm run db:deploy -w backend && node backend/dist/index.js"]