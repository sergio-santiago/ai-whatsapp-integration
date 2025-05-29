# Chatbot WhatsApp con AI21
# AI WhatsApp Integration

A Node.js application that integrates AI21 Studio with WhatsApp Business API to provide AI-powered responses to WhatsApp messages.

> 🔗 **Includes ngrok integration** for exposing your local webhook to the internet.

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
4. Get your ngrok authentication token from [ngrok dashboard](https://dashboard.ngrok.com) and add it to your `.env` file

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

## Using ngrok for Webhooks

The project includes ngrok as a Docker service to expose your local webhook to the internet.

1. Make sure you have added your ngrok authentication token to the `.env` file:
   ```
   NGROK_AUTHTOKEN=your_ngrok_auth_token
   ```

2. Start the application with ngrok:
   ```bash
   make init
   ```

3. Get your public webhook URL:
   ```bash
   make ngrok-url
   ```

4. Use the URL displayed (ending with `/webhook`) to configure your WhatsApp Business API webhook.

5. View ngrok logs to debug connections:
   ```bash
   make ngrok-logs
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
├── docker-compose.yml  # Docker Compose configuration (with ngrok service)
├── Makefile            # Make commands
└── index.js            # Application entry point
```
