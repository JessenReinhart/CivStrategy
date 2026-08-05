#!/bin/bash
# Local verification workflow - runs the same checks as CI
# Usage: ./scripts/verify.sh

set -e

echo "🔍 Starting code verification workflow..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Track if any check failed
FAILED=0

# 1. TypeScript type check (strict, full output)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  TypeScript Type Check"
npx tsc --noEmit > /tmp/tsc-output.txt 2>&1 || true

# Filter out the entire vite.config.d.ts error block (error + 2 context lines)
grep -v "vite.config.d.ts\|The file is in the program\|Matched by include pattern" /tmp/tsc-output.txt > /tmp/tsc-filtered.txt || true

if [ -s /tmp/tsc-filtered.txt ]; then
    echo -e "${RED}❌ TypeScript errors found:${NC}"
    cat /tmp/tsc-filtered.txt
    FAILED=1
else
    echo -e "${GREEN}✅ TypeScript check passed${NC}"
fi
echo ""

# 2. ESLint check
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  ESLint Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if npm run lint; then
    echo -e "${GREEN}✅ ESLint check passed${NC}"
else
    echo -e "${RED}❌ ESLint errors found${NC}"
    FAILED=1
fi
echo ""

# 3. Tests
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  Unit Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if npm run test; then
    echo -e "${GREEN}✅ Tests passed${NC}"
else
    echo -e "${RED}❌ Tests failed${NC}"
    FAILED=1
fi
echo ""

# 4. Fallow - Dead code detection (non-blocking)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4️⃣  Fallow Dead Code Detection"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
npx fallow dead-code 2>&1 || true
echo -e "${YELLOW}(Fallow findings are informational, not blocking)${NC}"
echo ""

# 5. Fallow - Full analysis (non-blocking)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5️⃣  Fallow Full Analysis"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
npx fallow 2>&1 || true
echo -e "${YELLOW}(Fallow findings are informational, not blocking)${NC}"
echo ""

# 6. Build check
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6️⃣  Production Build Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if npm run build; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed${NC}"
    FAILED=1
fi
echo ""

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Verification Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All critical checks passed!${NC}"
    echo -e "${YELLOW}Review Fallow findings above for technical debt.${NC}"
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Please fix the errors above.${NC}"
    exit 1
fi
