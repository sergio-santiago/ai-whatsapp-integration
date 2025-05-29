#!/bin/bash

# Script para configurar ngrok en caso de que desees usarlo localmente sin Docker

echo "Configurando ngrok para la integración con WhatsApp..."

# Verificar si ngrok ya está instalado
if command -v ngrok &> /dev/null; then
    echo "✅ ngrok ya está instalado"
else
    echo "🔄 Instalando ngrok..."
    # Para Mac (usando Homebrew)
    if command -v brew &> /dev/null; then
        brew install ngrok
    # Para Linux (usando npm)
    elif command -v npm &> /dev/null; then
        npm install -g ngrok
    else
        echo "❌ No se pudo instalar ngrok automáticamente. Instálalo manualmente desde https://ngrok.com/download"
        exit 1
    fi
fi

# Verificar si se proporcionó un token de autenticación
if [ -z "$1" ]; then
    echo "⚠️ No se proporcionó un token de autenticación."
    echo "Obten tu token en https://dashboard.ngrok.com/get-started/your-authtoken"
    read -p "Ingresa tu token de autenticación de ngrok: " NGROK_TOKEN
else
    NGROK_TOKEN=$1
fi

# Configurar el token de autenticación
ngrok config add-authtoken $NGROK_TOKEN

echo "✅ ngrok configurado correctamente"
echo "Para iniciar ngrok y exponer tu aplicación local, ejecuta:"
echo "ngrok http 3000"

# Agregar el token al archivo .env si existe
if [ -f .env ]; then
    if grep -q "NGROK_AUTHTOKEN" .env; then
        sed -i.bak "s/NGROK_AUTHTOKEN=.*/NGROK_AUTHTOKEN=$NGROK_TOKEN/g" .env
        rm -f .env.bak 2>/dev/null
    else
        echo "\nNGROK_AUTHTOKEN=$NGROK_TOKEN" >> .env
    fi
    echo "✅ Token agregado al archivo .env"
fi
