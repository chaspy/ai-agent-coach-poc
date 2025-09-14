# Agent PoC Makefile Commands
# このファイルは既存のMakefileに追加、または単独で使用できます

.PHONY: agents-setup dev-agents dev-agents-web agents-clean agents-test

# セットアップ: 全エージェントの依存関係インストール
agents-setup:
	@echo "🔧 Agent PoC セットアップ開始..."
	@cd agent-poc && npm install
	@cd agent-poc-web && npm install
	@cd agent-poc-lg && npm install
	@cd agent-poc-oa && npm install
	@echo "✅ セットアップ完了"

# 開発: エージェントのみ起動（バックエンド3つ）
dev-agents:
	@echo "🚀 エージェント起動中 (Mastra, LangGraph, OpenAI SDK)..."
	npm run dev:agents:all

# 開発: エージェント + Web UI起動
dev-agents-web:
	@echo "🚀 エージェント + Web UI 起動中..."
	npm run dev:agents:web

# 個別起動コマンド
dev-agent-mastra:
	@echo "🔵 Mastraエンジン起動中 (port: 4120)..."
	npm run dev:agent

dev-agent-lg:
	@echo "🟣 LangGraph.js起動中 (port: 4121)..."
	npm run dev:agent-lg

dev-agent-oa:
	@echo "🟢 OpenAI SDK起動中 (port: 4122)..."
	npm run dev:agent-oa

dev-agent-web:
	@echo "🌐 Web UI起動中 (port: 5179)..."
	npm run dev:agent-web

# ビルド
build-agents:
	@echo "🏗️  全エージェントをビルド中..."
	npm run build:agent
	npm run build:agent-lg
	npm run build:agent-oa
	npm run build:agent-web

# クリーンアップ
agents-clean:
	@echo "🧹 クリーンアップ中..."
	rm -rf agent-poc/node_modules agent-poc/dist
	rm -rf agent-poc-lg/node_modules agent-poc-lg/dist
	rm -rf agent-poc-oa/node_modules agent-poc-oa/dist
	rm -rf agent-poc-web/node_modules agent-poc-web/dist

# テスト実行（将来の拡張用）
agents-test:
	@echo "🧪 テスト実行中..."
	@echo "⚠️  テストは未実装です"

# ヘルプ
agents-help:
	@echo "📚 Agent PoC コマンド一覧:"
	@echo ""
	@echo "  make agents-setup      - 依存関係インストール"
	@echo "  make dev-agents-web    - 全エージェント + Web UI起動"
	@echo "  make dev-agents        - エージェントのみ起動"
	@echo "  make dev-agent-mastra  - Mastraエンジンのみ起動"
	@echo "  make dev-agent-lg      - LangGraph.jsのみ起動"
	@echo "  make dev-agent-oa      - OpenAI SDKのみ起動"
	@echo "  make dev-agent-web     - Web UIのみ起動"
	@echo "  make build-agents      - 全エージェントをビルド"
	@echo "  make agents-clean      - クリーンアップ"
	@echo ""
	@echo "ポート設定:"
	@echo "  - Mastra: 4120"
	@echo "  - LangGraph: 4121"
	@echo "  - OpenAI SDK: 4122"
	@echo "  - Web UI: 5179"