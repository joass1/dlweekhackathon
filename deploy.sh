#!/usr/bin/env bash
# deploy.sh — Deploy knowledge-network (Next.js) to Vercel
set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "$0")/knowledge-network" && pwd)"

echo "==> Deploying knowledge-network to Vercel"
echo "    Directory: $FRONTEND_DIR"

# ── 1. Ensure Vercel CLI is available ────────────────────────────────────────
if ! command -v vercel &>/dev/null; then
  echo "==> Vercel CLI not found. Installing globally..."
  npm install -g vercel
fi

VERCEL=$(command -v vercel)
echo "==> Using Vercel CLI: $($VERCEL --version)"

# ── 2. Check required env vars ───────────────────────────────────────────────
# These must be set in your shell before running this script,
# or exported from a .env.local file (never commit secrets to git).
REQUIRED_VARS=(GITHUB_ID GITHUB_SECRET NEXTAUTH_SECRET NEXTAUTH_URL)
MISSING=0
for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "  [!] Missing env var: $var"
    MISSING=1
  fi
done

if [[ $MISSING -eq 1 ]]; then
  echo ""
  echo "Set the missing variables before deploying. Example:"
  echo "  export GITHUB_ID=your_github_client_id"
  echo "  export GITHUB_SECRET=your_github_client_secret"
  echo "  export NEXTAUTH_SECRET=\$(openssl rand -base64 32)"
  echo "  export NEXTAUTH_URL=https://your-app.vercel.app"
  echo ""
  exit 1
fi

# ── 3. Install dependencies ───────────────────────────────────────────────────
echo "==> Installing dependencies..."
cd "$FRONTEND_DIR"
npm install --legacy-peer-deps

# ── 4. Build locally to catch errors before deploying ────────────────────────
echo "==> Building..."
npm run build

# ── 5. Deploy to Vercel ───────────────────────────────────────────────────────
echo "==> Deploying to Vercel..."
cd "$FRONTEND_DIR"

# Pull existing project settings if already linked, otherwise link/create
if [[ ! -f ".vercel/project.json" ]]; then
  echo "    No Vercel project found — running first-time setup."
  echo "    You'll be prompted to log in and link/create the project."
  $VERCEL link --yes
fi

# Push environment variables to Vercel (production)
echo "==> Setting environment variables on Vercel..."
$VERCEL env add GITHUB_ID    production <<< "$GITHUB_ID"    2>/dev/null || true
$VERCEL env add GITHUB_SECRET production <<< "$GITHUB_SECRET" 2>/dev/null || true
$VERCEL env add NEXTAUTH_SECRET production <<< "$NEXTAUTH_SECRET" 2>/dev/null || true
$VERCEL env add NEXTAUTH_URL  production <<< "$NEXTAUTH_URL"  2>/dev/null || true

# Deploy to production
echo "==> Pushing to production..."
$VERCEL --prod --yes

echo ""
echo "==> Done! Your app is live."
