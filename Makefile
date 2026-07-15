.PHONY: setup install dev docker-up docker-down test lint format build

# Default target
all: install

# Setup and dependencies installation
setup: install

install:
	@echo "Installing root, backend, and frontend dependencies..."
	# Backend install (using uv)
	cd backend && uv sync
	# Frontend install (using pnpm)
	cd frontend && pnpm install

# Run development servers locally
dev:
	@echo "Starting backend and frontend services locally..."
	# Run backend on port 8000, frontend on port 3001 using concurrently to prevent orphaned processes
	npx -y concurrently --kill-others \
		--names "frontend,backend" \
		--prefix-colors "cyan,magenta" \
		"pnpm --dir frontend dev" \
		"cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

# Docker Compose targets
docker-up:
	docker-compose up --build

docker-down:
	docker-compose down

# Seeding database
seed:
	@echo "Seeding Neo4j database with sample data..."
	cd backend && uv run python -m app.scripts.seed_data


# Testing
test:
	@echo "Running tests..."
	cd backend && uv run pytest
	cd frontend && pnpm test

# Linting
lint:
	@echo "Running linters..."
	cd backend && uv run ruff check .
	cd frontend && pnpm run lint

# Formatting
format:
	@echo "Running formatters..."
	cd backend && uv run ruff format .
	cd frontend && pnpm run format

# Build production bundles
build:
	@echo "Building application for production..."
	cd backend && uv run python -m compileall app/
	cd frontend && pnpm run build
