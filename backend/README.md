# Backend — Isla Misteriosa (MVP)

Backend **autoritativo** del juego: carga el [catálogo](../catalog/), lo **valida**
contra el [schema](../schemas/) al bootear, y procesa comandos devolviendo eventos
(decisiones [A1–A6](../docs/PREGUNTAS.md)). TypeScript + Node, arquitectura
**hexagonal**.

## Correr

```bash
pnpm install
pnpm start            # in-memory (default) en http://localhost:3000
DB=sqlite pnpm start  # persistencia SQLite (island.db)
pnpm test             # tests del motor de interacción
pnpm typecheck    # tsc --noEmit
```

> `better-sqlite3` es **opcional**: si el binario nativo no compila, el backend
> arranca igual con in-memory.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/catalog` | el catálogo ensamblado (contenido data-driven) |
| `GET` | `/zones/:zoneId` | snapshot de la zona (tiles con visibilidad, objetos, items) |
| `GET` | `/players/:playerId/state` | jugador, inventario, conocimiento, pensamientos |
| `POST` | `/commands` | valida contra `commands.json` y procesa → `CommandResult` |
| `GET` | `/health` | liveness |

## Arquitectura (hexagonal)

```
src/
├─ contract/        tipos del contrato (copiados de schemas/generated — pnpm sync:contract)
├─ domain/          LÓGICA PURA, sin IO
│  ├─ engine.ts        motor de interacción: requirements -> inputs -> chance -> effects -> eventos
│  ├─ reducer.ts       applyEvent(state, evento): único lugar que muta el estado
│  ├─ inventory.ts     grilla 4x4, manos, formas/rotación (B3)
│  ├─ pathfinding.ts   BFS sobre tiles caminables (B5, C3)
│  ├─ visibility.ts    radio circular (C2)
│  └─ state.ts         modelo de estado en runtime
├─ application/     casos de uso
│  ├─ process-command.ts  dispatcher de los 7 comandos
│  └─ game-service.ts     snapshots + comando sobre el repo
├─ infrastructure/  adapters (IO)
│  ├─ catalog/loader.ts        lee /catalog + valida vs /schemas (ajv, fail-fast)
│  ├─ persistence/             puerto GameRepository + in-memory + SQLite
│  └─ http/server.ts           Fastify
└─ bootstrap/       seed del mundo MVP + wiring (main.ts)
```

**El dominio no importa nada de infraestructura.** El motor es data-driven: lee el
catálogo y NO conoce acciones concretas. La persistencia está detrás del puerto
`GameRepository`, así que SQLite → Postgres no toca el dominio.

## Qué está implementado

- Carga + **validación** del catálogo contra el schema al iniciar (fail-fast).
- Los 7 comandos: `MovePlayer` (A*), `ExecuteAction` (motor completo), `Rest`,
  `Observe`, `TakeItem`, `DropItem`, `MoveItem`.
- Motor de interacción genérico: requisitos, resolución de inputs por contexto
  (hands/adjacent/surface — C4), tirada con **penalización por energía baja** (C1),
  efectos → eventos, reducer event-sourced.
- Inventario 4x4 con manos y rotación de objetos largos (B3).
- Snapshots con visibilidad por tile; rechazos de dominio como pensamiento en
  primera persona (C3).
- Adapters in-memory **y** SQLite; seed de un mundo MVP jugable.
- Tests del motor (cadena jugable) — `pnpm test`.

## Simplificaciones del esqueleto (TODO)

- **Inventario:** la fila de manos `x--x` se trata como grilla plena; falta la regla
  de los slots centrales reservados.
- **`surface` scope:** se aproxima como suelo adyacente al target; falta la grilla
  real de la mesa.
- **Pilas:** sólo visual (B4); `TakeItem` sobre pila no implementado aún.
- **SQLite:** persiste el estado como snapshot JSON por jugador; tablas normalizadas
  es trabajo posterior (el puerto ya aísla el cambio).
- **Sin auth, una sola zona/jugador, sin WebSocket** (el real-time es post-MVP — A4).

## Relacionado

- [Contrato de API](../docs/3-backend-api/contrato-api.md) · [Comandos y eventos](../docs/3-backend-api/comandos-eventos.md)
- [Catálogo](../catalog/) · [Schemas](../schemas/)
- [Separación backend / frontend](../docs/3-backend-api/separacion-backend-frontend.md)
