# Chatbot WhatsApp con AI21
# AI WhatsApp Integration

A Node.js application that integrates AI21 Studio with WhatsApp Business API to provide AI-powered responses to WhatsApp messages.

## Requirements

- Docker & Docker Compose
- Node.js 18+ (for local development without Docker)
- WhatsApp Business API account
- AI21 Studio API key

## Setup

1. Clone this repository
2. Copy the `.env.example` file to `.env` and fill in your API keys and configuration:
   ```
   cp .env.example .env
   ```
3. Edit the `.env` file with your actual credentials

## Running with Docker

This project includes Docker configuration for easy deployment.

### Using Make Commands

The project includes a Makefile with common commands:

```bash
# Build the Docker image
make build

# Run the application
make run

# View logs
make logs

# Stop the application
make stop

# For development with live reloading
make dev

# See all available commands
make help
```

### Using Docker Compose Directly

```bash
# Build and start the application
docker-compose up -d

# Stop the application
docker-compose down
```

## Running Locally (Without Docker)

```bash
# Install dependencies
npm install

# Start development server with hot reloading
npm run dev

# Start production server
node index.js
```

## Project Structure

```
├── src/
│   ├── config/          # Configuration settings
│   ├── routes/          # API route definitions
│   └── services/        # Business logic
├── .env                 # Environment variables (create from .env.example)
├── .env.example        # Example environment file
├── Dockerfile          # Docker configuration
├── docker-compose.yml  # Docker Compose configuration
├── Makefile            # Make commands
└── index.js            # Application entry point
```
