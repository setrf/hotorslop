#!/bin/bash

echo "🚀 Setting up Hot or Slop Backend Server..."
echo

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm and try again."
    exit 1
fi

echo "✅ Node.js $(node --version) and npm $(npm --version) found"

# Install dependencies
echo
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "✅ .env file created"
else
    echo
    echo "📝 .env file already exists"
fi

echo
echo "🎉 Setup complete! You can now start the server with:"
echo "   npm run dev"
echo
echo "📊 The server will be available at: http://localhost:3001"
echo "🔗 Make sure your frontend is configured to connect to this server"