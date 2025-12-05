#!/bin/bash
# Helper script to run visual QA tests
# Checks prerequisites and runs Puppeteer tests via npx

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🎨 Secret Santa Visual QA Runner${NC}"
echo "=================================="
echo ""

# Check if development server is running
echo "Checking prerequisites..."
echo ""

echo -n "Checking dev server (localhost:3000)... "
if curl -f http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Running${NC}"
else
    echo -e "${RED}❌ Not running${NC}"
    echo ""
    echo -e "${RED}Error: Development server not detected${NC}"
    echo "Please start the server with: npm run dev"
    exit 1
fi

echo -n "Checking Firebase Emulator (port 8080)... "
if lsof -i :8080 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Running${NC}"
else
    echo -e "${YELLOW}⚠️  Not running${NC}"
    echo ""
    echo -e "${YELLOW}Warning: Firebase Emulator not detected${NC}"
    echo "Some tests may fail. Start emulators with: npm run emulators"
    echo ""
    read -p "Continue anyway? (yes/no): " CONTINUE
    if [ "$CONTINUE" != "yes" ]; then
        echo "Aborted"
        exit 1
    fi
fi

echo -n "Checking Auth Emulator (port 9099)... "
if lsof -i :9099 > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Running${NC}"
else
    echo -e "${YELLOW}⚠️  Not running${NC}"
fi

echo ""
echo "=================================="
echo ""

# Run the visual QA script using npx
echo -e "${BLUE}Running visual QA tests...${NC}"
echo ""

# Use npx to run Puppeteer without installing it
npx -y puppeteer@latest node scripts/visual_qa.js

# Capture exit code
EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✨ Visual QA tests passed!${NC}"
    echo ""
    echo "Screenshots saved to: qa_artifacts/"
    echo ""
    echo "View screenshots:"
    echo "  ls -lh qa_artifacts/"
else
    echo -e "${RED}❌ Visual QA tests failed${NC}"
    echo ""
    echo "Check screenshots in qa_artifacts/ for details"
fi

exit $EXIT_CODE
