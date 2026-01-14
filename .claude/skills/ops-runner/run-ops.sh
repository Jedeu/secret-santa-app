#!/bin/bash
#
# Ops Runner - Project operations for build validation and PWA assets
#
# Usage:
#   ./run-ops.sh lint   - Run ESLint
#   ./run-ops.sh build  - Run Next.js build
#   ./run-ops.sh pwa    - Generate/validate PWA assets
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get project root (parent of .claude directory)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$PROJECT_ROOT"

# ============================================================================
# LINT COMMAND
# ============================================================================
run_lint() {
    echo -e "${YELLOW}Running ESLint...${NC}"

    if npm run lint; then
        echo -e "${GREEN}✅ Lint passed - no errors found${NC}"
        exit 0
    else
        echo -e "${RED}❌ Lint failed${NC}"
        echo ""
        echo "Fix the errors above before proceeding."
        echo "Tip: Run 'npm run lint -- --fix' for auto-fixable issues."
        exit 1
    fi
}

# ============================================================================
# BUILD COMMAND
# ============================================================================
run_build() {
    echo -e "${YELLOW}Running Next.js production build...${NC}"

    if npm run build; then
        echo -e "${GREEN}✅ Build succeeded${NC}"
        exit 0
    else
        echo -e "${RED}❌ Build failed${NC}"
        echo ""
        echo "Review the errors above. Common causes:"
        echo "- Import errors (missing modules)"
        echo "- TypeScript errors (if using TS)"
        echo "- Dynamic code issues (server/client mismatch)"
        exit 1
    fi
}

# ============================================================================
# PWA COMMAND
# ============================================================================
run_pwa() {
    echo -e "${YELLOW}Checking PWA assets...${NC}"

    local errors=0

    # Check manifest.json
    if [ -f "public/manifest.json" ]; then
        if node -e "JSON.parse(require('fs').readFileSync('public/manifest.json'))" 2>/dev/null; then
            echo -e "${GREEN}✅ manifest.json exists and is valid JSON${NC}"
        else
            echo -e "${RED}❌ manifest.json has invalid JSON${NC}"
            errors=$((errors + 1))
        fi
    else
        echo -e "${RED}❌ manifest.json missing at public/manifest.json${NC}"
        errors=$((errors + 1))
    fi

    # Check icons directory
    if [ -d "public/icons" ]; then
        echo -e "${GREEN}✅ Icons directory exists${NC}"

        # Check required icon sizes
        for size in "192x192" "512x512"; do
            if [ -f "public/icons/icon-${size}.png" ]; then
                echo -e "${GREEN}  ✅ icon-${size}.png exists${NC}"
            else
                echo -e "${YELLOW}  ⚠️  icon-${size}.png missing${NC}"
            fi
        done

        # Check apple touch icon
        if [ -f "public/icons/apple-touch-icon.png" ]; then
            echo -e "${GREEN}  ✅ apple-touch-icon.png exists${NC}"
        else
            echo -e "${YELLOW}  ⚠️  apple-touch-icon.png missing${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  Icons directory missing at public/icons/${NC}"
        echo ""
        echo "Creating icons directory and placeholder icons..."

        mkdir -p public/icons

        # Try to create placeholder icons with ImageMagick
        if command -v convert &> /dev/null; then
            echo "Using ImageMagick to generate placeholder icons..."
            convert -size 192x192 xc:'#e94560' public/icons/icon-192x192.png
            convert -size 512x512 xc:'#e94560' public/icons/icon-512x512.png
            convert -size 180x180 xc:'#e94560' public/icons/apple-touch-icon.png
            echo -e "${GREEN}✅ Placeholder icons created${NC}"
        else
            echo -e "${YELLOW}⚠️  ImageMagick not available${NC}"
            echo "Creating minimal PNG placeholders..."

            # Minimal valid 1x1 red PNG (base64 encoded)
            # This is a valid PNG that can be scaled, just looks like a red pixel
            local PNG_DATA="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="

            echo "$PNG_DATA" | base64 -d > public/icons/icon-192x192.png
            echo "$PNG_DATA" | base64 -d > public/icons/icon-512x512.png
            echo "$PNG_DATA" | base64 -d > public/icons/apple-touch-icon.png

            echo -e "${YELLOW}⚠️  Minimal placeholder icons created${NC}"
            echo "TODO: Replace with proper icon designs"
        fi
    fi

    if [ $errors -gt 0 ]; then
        echo ""
        echo -e "${RED}❌ PWA check failed with $errors error(s)${NC}"
        exit 1
    else
        echo ""
        echo -e "${GREEN}✅ PWA assets validated${NC}"
        exit 0
    fi
}

# ============================================================================
# MAIN
# ============================================================================
show_help() {
    cat << EOF
Ops Runner - Project operations for build validation and PWA assets

Usage: $(basename "$0") <command>

Commands:
    lint    Run ESLint to check code quality
    build   Run Next.js production build
    pwa     Generate/validate PWA assets (manifest, icons)
    help    Show this help message

Examples:
    $(basename "$0") lint           # Quick lint check
    $(basename "$0") build          # Verify production build
    $(basename "$0") pwa            # Validate PWA readiness

Exit Codes:
    0       Success
    1       Command failed (lint/build/pwa errors)
    2       Invalid command
EOF
}

case "${1:-help}" in
    lint)
        run_lint
        ;;
    build)
        run_build
        ;;
    pwa)
        run_pwa
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        echo ""
        show_help
        exit 2
        ;;
esac
