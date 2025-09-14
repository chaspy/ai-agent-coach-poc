#!/bin/bash
set -e

echo "🔧 Agent PoC セットアップ開始..."

# 依存関係インストール
echo "📦 依存関係をインストール中..."
npm install

for dir in agent-poc agent-poc-lg agent-poc-oa agent-poc-web; do
    if [ -d "$dir" ]; then
        echo "  - $dir の依存関係をインストール中..."
        (cd "$dir" && npm install)
    fi
done

# .env ファイル作成確認
echo ""
echo "⚠️  重要: 各エージェントディレクトリに .env ファイルを作成してください"
echo "  cp agent-poc/.env.example agent-poc/.env"
echo "  cp agent-poc-lg/.env.example agent-poc-lg/.env"
echo "  cp agent-poc-oa/.env.example agent-poc-oa/.env"
echo ""
echo "  そして OPENAI_API_KEY を設定してください"
echo ""
echo "✅ セットアップ完了！"
echo ""
echo "🚀 起動方法:"
echo "  npm run dev:agents:web    # 全エージェント + Web UI"
echo "  npm run dev:agent         # Mastraエンジンのみ"
echo "  npm run dev:agent-web     # Web UIのみ"
echo "  make dev-agents-web       # Makefile経由で起動"
