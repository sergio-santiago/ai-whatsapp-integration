# AI21 WhatsApp Chatbot Integration

A Node.js application that integrates AI21 Studio with WhatsApp Business API to provide AI-powered responses to WhatsApp messages.

> 🔗 **Includes ngrok integration** for exposing your local webhook to the internet.

## Requirements

- Docker & Docker Compose
- Node.js 18+ (for local development without Docker)
- WhatsApp Business API account
- AI21 Studio API key

## Setup

1. Clone this repository
2. Copy the `.env.example` file to `.env`:
   ```
   cp .env.example .env
   ```
3. Edit the `.env` file with your credentials provided in the next step

## Environment Variables Setup

### AI21 Studio API Key (`AI21_API_KEY`)
1. Create an account at [AI21 Studio](https://studio.ai21.com/)
2. Go to your Workspace API keys
3. Copy your API key from the "API Key" section

### WhatsApp Business API Configuration
To get the `PHONE_NUMBER_ID` and `WHATSAPP_TOKEN`:

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Create or select your app (Choose "Business" type)
3. Add WhatsApp product to your app
4. Go to WhatsApp > Getting Started
5. Set up your WhatsApp business account if you haven't already
6. Generate and copy your `WHATSAPP_TOKEN` from the "Temporary access token" section
7. Find your `PHONE_NUMBER_ID` in the "From" field (Number ID, not the number itself)
8. Configure your webhook URL using the ngrok URL (see "Using ngrok for Webhooks" section below)

### Verification Token (`VERIFY_TOKEN`)
This is a custom string that you create yourself. It should be:
- Random and unique
- At least 32 characters long
- Kept secret and secure

Example of generating a secure token:
```bash
# Using OpenSSL (recommended)
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

When configuring your webhook in the Meta for Developers dashboard, you'll need to provide this same `VERIFY_TOKEN` value.

### Ngrok Authentication Token (`NGROK_AUTHTOKEN`)

1. Sign up or log in to your [ngrok dashboard](https://dashboard.ngrok.com)
2. Navigate to the "Your Authtoken" section
3. Copy your authentication token
4. Add it to your `.env` file as `NGROK_AUTHTOKEN`

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
