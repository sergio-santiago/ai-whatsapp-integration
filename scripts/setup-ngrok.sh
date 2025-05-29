#!/bin/bash

# Script to configure ngrok in case you want to use it locally without Docker

echo "Configuring ngrok for WhatsApp integration..."

# Check if ngrok is already installed
if command -v ngrok &> /dev/null; then
    echo "✅ ngrok is already installed"
else
    echo "🔄 Installing ngrok..."
    # Para Mac (usando Homebrew)
    if command -v brew &> /dev/null; then
        brew install ngrok
    # Para Linux (usando npm)
    elif command -v npm &> /dev/null; then
        npm install -g ngrok
    else
        echo "❌ Could not install ngrok automatically. Install it manually from https://ngrok.com/download"
        exit 1
    fi
fi

# Check if an authentication token was provided
if [ -z "$1" ]; then
    echo "⚠️ No authentication token provided."
    echo "Get your token at https://dashboard.ngrok.com/get-started/your-authtoken"
    read -p "Enter your ngrok authentication token: " NGROK_TOKEN
else
    NGROK_TOKEN=$1
fi

# Configure the authentication token
ngrok config add-authtoken $NGROK_TOKEN

echo "✅ ngrok configured successfully"
echo "To start ngrok and expose your local application, run:"
echo "ngrok http 3000"

# Add the token to the .env file if it exists
if [ -f .env ]; then
    if grep -q "NGROK_AUTHTOKEN" .env; then
        sed -i.bak "s/NGROK_AUTHTOKEN=.*/NGROK_AUTHTOKEN=$NGROK_TOKEN/g" .env
        rm -f .env.bak 2>/dev/null
    else
        echo "\nNGROK_AUTHTOKEN=$NGROK_TOKEN" >> .env
    fi
    echo "✅ Token added to .env file"
fi
