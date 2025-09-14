# Repository Guidelines

## Project Structure & Module Organization
- Monorepo with npm workspaces: `frontend/`, `backend/`, `e2e/`.
- Docs and ops: `docs/`, `.github/`, `scripts/`.
- Frontend: React + Vite (`frontend/src/{components,pages,hooks,utils,generated}`).
- Backend: Express + tsoa + Prisma (`backend/src`, `backend/prisma`).
- API types are generated to `frontend/src/generated/api-types.ts` from `backend/openapi.yaml`.

## Build, Test, and Development Commands
- `make dev`: Start native dev stack via `dev-up.sh` (backend, DB, frontend).
- `make agents-setup` / `make dev-agents-web`: Agents PoC（Mastra/LangGraph.js/OpenAI）+ Web を一括起動。
- `npm run dev:frontend` / `npm run dev:backend`: Run each app locally.
- `make lint` / `make format-all`: Prettier format + ESLint across workspaces.
- `make routes` → `make api-gen`: Regenerate `tsoa` routes and frontend API types.
- `make e2e` / `make e2e-headed`: Playwright E2E (headless/with browser).
- `make prisma-studio`: Open Prisma Studio (local DB).

## Coding Style & Naming Conventions
- TypeScript-first; 2-space indent; Prettier enforced. Run `make lint` before committing.
- ESLint config enables React + `@typescript-eslint` (e.g., prefer nullish coalescing/optional chaining, no unused vars unless prefixed `_`).
- Naming: React components `PascalCase` (e.g., `UserCard.tsx`); variables/functions `camelCase`; backend files `kebab-case` or domain-oriented folders under `src/`.

## Testing Guidelines
- Frontend: Vitest (`frontend`), run `npm test` or `npm run test:coverage`.
- Backend: Jest (`backend`), run `npm test` or `npm run test:coverage`.
- E2E: Playwright (`e2e`), run `npm run test:e2e` or `make e2e`.
- Coverage targets: FE ≥ 70%, BE ≥ 80%; keep/add tests with new features.
- Test files: `*.test.ts(x)` for frontend, `*.spec.ts` for backend.

## Commit & Pull Request Guidelines
- Use conventional prefixes: `feat:`, `fix:`, `chore:`, `docs:`, etc. Japanese allowed; avoid emojis for Cloudflare Pages compatibility.
- Before pushing: `make lint` + unit tests pass. If backend API changes, run `make api-gen`.
- PRs: Use the template; include clear description, linked issues (`#123`), screenshots for UI, and test plan/coverage notes.

## Security & Configuration Tips
- Do not commit secrets. Use `.envrc`/`.envrc.example` and `direnv allow` locally.
- For local DB work: migrate/seed via Prisma, browse with `make prisma-studio`.
- Architecture: Express + tsoa generates OpenAPI; frontend consumes typed client from `openapi-typescript`.

## Agent-Specific Instructions
- Codex CLI users: see `CODEX.md` for agent workflow, file-change policy, Japanese PR/commit rules, and tool usage.
- Response language: default to Japanese; follow explicit user preference.
- Priority: when using Codex CLI, `CODEX.md` takes precedence where guidance conflicts; this file remains the baseline repository-wide policy.
