#!/bin/bash
# Helper script to reset the database
# This script provides better error handling and user feedback

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔄 Secret Santa Database Reset Helper"
echo "====================================="
echo ""

# Check if server is running
echo "Checking if server is running at localhost:3000..."
if ! curl -f http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${RED}❌ Server not running at localhost:3000${NC}"
    echo "Please start the server with: npm run dev"
    exit 1
fi
echo -e "${GREEN}✅ Server is running${NC}"
echo ""

# Check if emulator is running
echo "Checking if Firebase Emulator is running..."
if ! lsof -i :8080 > /dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Warning: Firebase Emulator may not be running on port 8080${NC}"
    echo "If reset fails, start emulators with: npm run emulators"
fi
echo ""

# Get auth token
echo -e "${YELLOW}⚠️  Auth Token Required${NC}"
echo "This endpoint requires a Firebase auth token for jed.piezas@gmail.com"
echo ""
echo "To get your token:"
echo "1. Open the app in your browser (localhost:3000)"
echo "2. Sign in as jed.piezas@gmail.com"
echo "3. Open browser console and run:"
echo "   firebase.auth().currentUser.getIdToken().then(console.log)"
echo ""
read -p "Enter your auth token: " TOKEN

if [ -z "$TOKEN" ]; then
    echo -e "${RED}❌ No token provided${NC}"
    exit 1
fi

# Perform reset
echo ""
echo "🚨 WARNING: This will delete ALL data (users, messages, assignments)"
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Reset cancelled"
    exit 0
fi

echo ""
echo "Sending reset request..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/admin/reset \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Database reset successful!${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
else
    echo -e "${RED}❌ Reset failed (HTTP $HTTP_CODE)${NC}"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
    exit 1
fi

echo ""
echo -e "${GREEN}✨ Done! Database has been reset and participants re-initialized.${NC}"
