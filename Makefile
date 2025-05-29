# Makefile for AI WhatsApp Integration project

.PHONY: build run stop restart logs clean dev test ngrok-logs ngrok-url

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
	docker-compose logs -f app

# View ngrok logs
ngrok-logs:
	docker-compose logs -f ngrok

# Get ngrok public URL
ngrok-url:
	@curl -s http://localhost:4040/api/tunnels | grep -o 'https://[^"]*'

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
	@echo "\nTo view ngrok public URL, run: make ngrok-url"

# Show help
help:
	@echo "Available commands:"
	@echo "  make build     - Build Docker image"
	@echo "  make run       - Start the application container"
	@echo "  make stop      - Stop running container"
	@echo "  make restart   - Restart the container"
	@echo "  make logs      - View application logs"
	@echo "  make ngrok-logs - View ngrok logs"
	@echo "  make ngrok-url - Get the public ngrok URL"
	@echo "  make clean     - Remove containers, volumes, and images"
	@echo "  make dev       - Run in development mode with live updates"
	@echo "  make test      - Run tests"
	@echo "  make init      - Initialize project (build and run)"

# Default target
.DEFAULT_GOAL := help
