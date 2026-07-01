# Separación backend / frontend

> Esta es una **propuesta arquitectónica**, no parte de los documentos originales.
> Nace de tu objetivo: *"backend por un lado y que el front consuma de eso, para
> tener front en distintas tecnologías"*. Las decisiones todavía abiertas están en
> [PREGUNTAS sección A](../PREGUNTAS.md#a-arquitectura-backend--frontend-lo-más-importante).

## Principio

- El **backend es autoritativo** del estado persistente y de las reglas del juego.
- El **frontend es una vista predictiva**: renderiza, captura input y *predice* lo
  latency-sensitive, pero nunca es la fuente de verdad.

El contrato entre ambos es **JSON sobre HTTP/WS**, agnóstico de tecnología de UI.
Cualquier front (web canvas/WebGL, nativo, móvil) consume la misma API.

## El problema de fondo: latencia vs autoridad

Este juego mezcla dos ritmos:

| Ritmo | Ejemplos | Sensibilidad a latencia |
|---|---|---|
| **Momento a momento** | mover, "primer click = observar", radio de visión, preview del menú | 🔴 Alta — un round-trip rompe el *feel* |
| **Acciones de mundo** | recolectar, craftear, combinar, despejar jungla, construir | 🟡 Media — toleran ~100–300 ms |
| **Social asincrónico** | visitar bases, usar máquinas ajenas, enseñar | 🟢 Nula — ya es offline por diseño |

La regla de oro: **nunca mandes al backend algo que el cliente ya puede resolver con
datos que ya tiene.** El cliente ya conoce los tiles y objetos *visibles*; observar,
seleccionar y previsualizar el menú son operaciones **locales**.

## Reparto de autoridad

| Responsabilidad | Backend (autoritativo) | Frontend (predice/renderiza) |
|---|---|---|
| Estado del mundo, inventario, conocimiento | ✅ fuente de verdad | cachea snapshot |
| Reglas de acciones contextuales | ✅ define y valida | recalcula *preview* con copia de reglas |
| Combinaciones ocultas / crafting | ✅ siempre valida (anti-cheat) | nunca decide el resultado |
| Resultado de una acción (efectos) | ✅ aplica y emite eventos | aplica optimista, reconcilia |
| Movimiento del personaje | ✅ valida path/colisión | **predice** y corrige si difiere |
| "Primer click = observar" | — | **100% cliente** (datos visibles) |
| Radio de visión | ✅ define qué entrega | calcula el efecto visual local |
| Drag & drop de inventario | ✅ valida espacio/forma | feedback inmediato, reconcilia |
| Generación de pensamientos | ✅ los de eventos de juego | puede mostrar los de *preview* local |
| Persistencia | ✅ | — |

> Las reglas de acciones contextuales viven en el backend, pero su forma es
> **data** (ver [`ContextAction`](../2-dominio/interaccion-contextual.md)). Eso
> permite enviar al cliente una **copia de las reglas relevantes** para que arme el
> menú sin round-trip, sin que el cliente pueda inventar acciones (la ejecución se
> revalida).

## Estrategia de latencia (client-side prediction)

1. **Observar / seleccionar / abrir menú:** local, sin red.
2. **Mover:** el cliente predice el paso por tile y lo muestra ya; manda el comando;
   si el backend corrige (path inválido), el cliente reconcilia.
3. **Acción de mundo (recolectar, cortar, combinar):** el cliente puede mostrar un
   estado optimista ("intentando…") y aplica el resultado real cuando llega el
   evento. Si falla, revierte y muestra el pensamiento de fallo.

## Forma del contrato (propuesta)

Modelo **comando → evento**, que encaja con el registro de acciones del social
asincrónico (GDD §23.5 "las acciones quedan registradas").

```
GET  /zones/{id}             → snapshot de la zona (tiles, objetos, visibilidad)
GET  /players/{id}/state     → player, inventario, conocimiento, thoughtLog
GET  /catalog                → ItemTypes, WorldObjectTypes, reglas de acciones (data-driven)
POST /commands               → { type, payload } → devuelve Event[]
```

Ejemplos de comando: `MovePlayer`, `ExecuteAction`, `MoveItem`, `DropItem`,
`TakeItem`, `Rest`, `Observe`. Cada uno devuelve los eventos que el cliente aplica
para reconciliar.

> **El contrato concreto ya está definido:** endpoints y tipos compartidos en
> [contrato-api.md](contrato-api.md); el contenido data-driven en
> [catalogo.md](catalogo.md); la lista completa de comandos y eventos en
> [comandos-eventos.md](comandos-eventos.md).

> **WebSocket** recién cuando exista presencia o tiempo real (no en MVP). El MVP es
> de una sola zona personal y puede vivir con HTTP + snapshot.
>
> ✅ **Decidido (A4):** post-MVP se usará **tiempo real** para interacciones de
> jugadores en la **misma zona**. El modelo comando→evento se mantiene; el
> transporte pasa a WebSocket para esa fase.

## Qué NO debe filtrar el contrato

- Detalles de una UI concreta (px, sprites, layout): eso es del front.
- IDs temporales de predicción del cliente: los IDs reales los genera el backend.
- Tile size, zoom, atlas de arte: configuración del front.

## Implicancias para el MVP

El **MVP Spec** asume cliente-only (lista "sin persistencia" como bug aceptable),
pero la decisión es **backend-first desde el día 1**.

✅ **Decidido (A1):** backend autoritativo ya en el MVP, con persistencia en
**SQLite**; migración a **PostgreSQL** más adelante. El cliente nunca calcula reglas
de juego: sólo render + input + predicción de lo latency-sensitive. Así el MVP ya
valida el contrato API y no se reescribe la lógica después.

> Mantener el acceso a datos detrás de un repositorio/abstracción para que el salto
> SQLite → Postgres no toque la lógica de dominio.

## Relacionado

- [Sistemas](../2-dominio/sistemas.md) — qué módulo es autoritativo
- [Interacción contextual](../2-dominio/interaccion-contextual.md)
- [Responsabilidades del frontend](../4-frontend/responsabilidades-frontend.md)
- [Modelo de datos](../2-dominio/modelo-de-datos.md)
