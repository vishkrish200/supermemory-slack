#!/bin/bash

# 🚀 Supermemory-Slack Connector Quick Setup
# This script helps you set up the environment for immediate testing

echo "🚀 Setting up Supermemory-Slack Connector for immediate testing..."
echo ""

# Check if .env exists
if [ -f ".env" ]; then
    echo "⚠️  .env file already exists. Backing up to .env.backup"
    cp .env .env.backup
fi

echo "📝 Creating .env file with required variables..."

cat > .env << EOF
# 🔐 Required Secrets
SECRET=$(openssl rand -base64 32)
SUPERMEMORY_API_KEY=your_supermemory_api_key_here

# 🎯 Slack App Credentials (get these from api.slack.com/apps)
SLACK_CLIENT_ID=your_slack_client_id_here
SLACK_CLIENT_SECRET=your_slack_client_secret_here  
SLACK_SIGNING_SECRET=your_slack_signing_secret_here

# 🔧 Optional GitHub Auth (for admin dashboard)
AUTH_GITHUB_ID=your_github_oauth_app_id
AUTH_GITHUB_SECRET=your_github_oauth_app_secret

# 📊 Optional Supermemory Rate Limiting (defaults work fine)
SUPERMEMORY_RATE_LIMIT=100
SUPERMEMORY_BURST_CAPACITY=50
EOF

echo "✅ Generated .env file with random SECRET key"
echo ""
echo "🎯 Next Steps:"
echo "1. Edit .env and add your API keys:"
echo "   - SUPERMEMORY_API_KEY (you have this working already!)"
echo "   - SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_SIGNING_SECRET"
echo ""
echo "2. Create Slack app:"
echo "   - Go to: https://api.slack.com/apps"
echo "   - Create New App → From an app manifest"
echo "   - Upload: slack-app-manifest-dev.yaml"
echo "   - Copy credentials to .env"
echo ""
echo "3. Start the connector:"
echo "   npm run dev"
echo ""
echo "📝 .env file created! Edit it with your credentials."

# Make file executable
chmod +x "$0" 