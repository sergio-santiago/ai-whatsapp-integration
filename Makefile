# Makefile for AI WhatsApp Integration project

.PHONY: build run stop restart logs clean dev test

# Build the Docker image
build:
	docker-compose build

# Run the application in a container
run:
	docker-compose up -d

# Stop the running container
stop:
	docker-compose down

# Restart the container
restart: stop run

# View application logs
logs:
	docker-compose logs -f

# Remove containers, volumes, and images
clean:
	docker-compose down -v --rmi local

# Run the application in development mode with volume mount
dev:
	docker-compose -f docker-compose.yml up

# Run tests
test:
	docker-compose run --rm app npm test

# Initialize the project for first time setup
init: build run

# Show help
help:
	@echo "Available commands:"
	@echo "  make build     - Build Docker image"
	@echo "  make run       - Start the application container"
	@echo "  make stop      - Stop running container"
	@echo "  make restart   - Restart the container"
	@echo "  make logs      - View application logs"
	@echo "  make clean     - Remove containers, volumes, and images"
	@echo "  make dev       - Run in development mode with live updates"
	@echo "  make test      - Run tests"
	@echo "  make init      - Initialize project (build and run)"

# Default target
.DEFAULT_GOAL := help
