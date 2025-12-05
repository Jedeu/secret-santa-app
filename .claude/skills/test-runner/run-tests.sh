#!/bin/bash
# Intelligent test runner for Secret Santa app
# Automatically selects unit or integration tests based on emulator availability

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧪 Secret Santa Test Runner${NC}"
echo "================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${RED}❌ Dependencies not installed${NC}"
    echo "Run: npm install"
    exit 1
fi

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -i :$port > /dev/null 2>&1; then
        return 0  # Port is in use
    else
        return 1  # Port is not in use
    fi
}

# Check emulator status
echo "Checking Firebase Emulator status..."
echo ""

FIRESTORE_RUNNING=false
AUTH_RUNNING=false
UI_RUNNING=false

if check_port 8080; then
    FIRESTORE_RUNNING=true
    echo -e "${GREEN}✅ Firestore Emulator (port 8080): Running${NC}"
else
    echo -e "${YELLOW}⚠️  Firestore Emulator (port 8080): Not running${NC}"
fi

if check_port 9099; then
    AUTH_RUNNING=true
    echo -e "${GREEN}✅ Auth Emulator (port 9099): Running${NC}"
else
    echo -e "${YELLOW}⚠️  Auth Emulator (port 9099): Not running${NC}"
fi

if check_port 4000; then
    UI_RUNNING=true
    echo -e "${GREEN}✅ Emulator UI (port 4000): Running${NC}"
else
    echo -e "${YELLOW}⚠️  Emulator UI (port 4000): Not running${NC}"
fi

echo ""
echo "================================"
echo ""

# Decide which tests to run
if [ "$FIRESTORE_RUNNING" = true ]; then
    echo -e "${GREEN}✅ Emulators detected - running INTEGRATION tests${NC}"
    echo "Command: npm run test:integration"
    echo ""
    npm run test:integration
else
    echo -e "${YELLOW}⚠️  Emulators not detected - running UNIT tests only${NC}"
    echo ""
    echo "To run integration tests:"
    echo "  1. Start emulators: npm run emulators"
    echo "  2. Run this script again"
    echo ""
    echo "Command: npm run test:unit"
    echo ""
    npm run test:unit
fi

# Capture exit code
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✨ All tests passed!${NC}"
else
    echo -e "${RED}❌ Some tests failed (exit code: $EXIT_CODE)${NC}"
fi

exit $EXIT_CODE
