# Agents PoC 起動ガイド

## 事前準備
- OpenAI APIキーを環境に設定（direnv 推奨）
  - 例: `export OPENAI_API_KEY=...`
- 依存関係のインストール
  - `make agents-setup`

## 一括起動
- API3種 + Web をまとめて起動
  - `make dev-agents-web`
  - 起動後:
    - Mastra API: http://localhost:4120/agent/healthz
    - LangGraph.js API: http://localhost:4121/agent/healthz
    - OpenAI Agents SDK API: http://localhost:4122/agent/healthz
    - Web: http://localhost:5179 （画面からエンジン切替）

## 個別起動
- APIのみ（3つ同時）: `make dev-agents`
- Webのみ: `npm run dev:agent-web`

## データ
- プロフィール: `agent-poc*/data/profiles/*.json`
- 履歴: `agent-poc*/data/history/*.jsonl`

## トラブルシュート
- `OPENAI_API_KEY が未設定`: シェルにエクスポートされているか確認（`env | grep OPENAI_API_KEY`）。
- ポート競合: 4120/4121/4122/5179 を使用。空けてから再実行。
- プロキシ失敗: `agent-poc-web/vite.config.ts` の `proxy` を確認。
