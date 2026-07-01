# Isla Misteriosa

Browser game (top-down, pixel/emoji, mouse-only, asynchronous multiplayer), built
backend-first with interchangeable frontends. The authoritative server owns all game
state; clients send commands and render events.

## Structure

| Package     | Role                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| `schemas/`  | JSON Schema (draft-07) for catalog/commands/events + ajv validator + TS codegen |
| `catalog/`  | Data-driven MVP content (terrains, items, objects, knowledge, actions)     |
| `backend/`  | Authoritative server — hexagonal architecture (TS/Node/Fastify), optional SQLite |
| `frontend/` | Reference web client — Vite vanilla-ts + Canvas 2D (emoji sprites)         |
| `docs/`     | Design docs by layer (vision, design, domain, backend-api, frontend, MVP, roadmap) |

Each package is standalone with its own `package.json` and `pnpm-lock.yaml`.

## Run locally

```bash
# Authoritative backend  →  http://localhost:3000
cd backend && pnpm install && pnpm start

# Reference client       →  http://localhost:5173
cd frontend && pnpm install && pnpm dev
```

## Gameplay loop

Gather materials → drop them next to you → improvise a tool (click your tile) →
equip it → chop trees → clear the jungle.

## Docs

Start at [`docs/`](docs/) — 39 documents organized by layer, plus `docs/PREGUNTAS.md`
with the resolved design decisions.
