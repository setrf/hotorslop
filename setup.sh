#!/bin/bash

echo "🚀 Setting up Hot or Slop - Full Stack Setup"
echo "============================================="
echo

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "🔍 Checking prerequisites..."

if ! command_exists node; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

if ! command_exists npm; then
    echo "❌ npm is not installed. Please install npm and try again."
    exit 1
fi

echo "✅ Node.js $(node --version) and npm $(npm --version) found"

# Install frontend dependencies
echo
echo "📦 Installing frontend dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install frontend dependencies"
    exit 1
fi

echo "✅ Frontend dependencies installed"

# Setup backend
echo
echo "🔧 Setting up backend server..."
if [ -f server/setup.sh ]; then
    cd server && bash setup.sh
    cd ..
else
    echo "❌ Backend setup script not found"
    exit 1
fi

echo
echo "🎉 Full setup complete!"
echo
echo "📋 Next steps:"
echo "1. Start the backend server: npm run server"
echo "2. Start the frontend dev server: npm run dev"
echo "3. Open http://localhost:5173 to play the game"
echo
echo "📊 Backend API will be available at: http://localhost:3001"
echo "🔗 The frontend will automatically connect to the backend for score persistence"