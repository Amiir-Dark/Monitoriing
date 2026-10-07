# Stage 1: Build React Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --prefer-offline || npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Go Backend
FROM golang:1.24-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o nodewatch ./cmd/nodewatch

# Stage 3: Minimal Production Image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata bash curl
WORKDIR /app

COPY --from=backend-builder /app/backend/nodewatch /app/nodewatch
COPY --from=frontend-builder /app/frontend/dist /app/dist

# Persistent data directory
VOLUME ["/app/data"]

EXPOSE 8080

ENTRYPOINT ["/app/nodewatch"]
CMD ["-port", "8080", "-db", "/app/data/nodewatch.db", "-dist", "/app/dist"]
