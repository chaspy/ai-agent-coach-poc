# agent-poc

Mastra + OpenAI を用いた AI Agent の最小 PoC（独立サービス）。

## 起動

1) 環境変数設定（direnv 推奨）

```
cp agent-poc/.envrc.example agent-poc/.envrc
# OPENAI_API_KEY を設定
# direnv allow
```

2) 起動

```
npm run dev:agent
```

- Health: http://localhost:4120/agent/healthz
- Ask API: `POST /agent/ask`

## リクエスト例

```
curl -sS localhost:4120/agent/ask \
 -H 'content-type: application/json' \
 -d '{
  "threadId": "thread_demo",
  "role": "student",
  "message": "明日の勉強の進め方を教えてください",
  "profileIds": {"self": "student_001", "peer": "coach_001"}
 }'
```

## データ
- `agent-poc/data/profiles/*.json`
- `agent-poc/data/history/*.jsonl`

