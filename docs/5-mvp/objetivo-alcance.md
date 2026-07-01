# MVP — Objetivo y alcance

> Fuente: MVP Systems Spec v0.1 §1–§2. Versión 0.1 — Vertical Slice jugable.

## 1. Objetivo del MVP

Validar el loop principal del juego en una experiencia corta, clara y jugable. El
MVP debe demostrar que estas acciones se sienten bien:

```
Mirar → Entender → Agarrar → Equipar en manos → Probar → Recibir pensamiento →
Descubrir → Construir → Abrir camino
```

La experiencia mínima deseada:

> El jugador despierta en una playa aislada, observa su entorno, recolecta objetos
> físicos, usa sus manos para cambiar las interacciones disponibles, descubre una
> herramienta rudimentaria, construye una fogata o mesa simple, fabrica una
> herramienta mejor y logra despejar el primer obstáculo de jungla espesa.

## 2. Alcance del MVP

### Incluye

- Mapa chico pixel art / tile-based.
- Personaje controlado solo con mouse.
- Radio de visión; tiles visibles, explorados y no vistos.
- Primer click para observar; segundo click para moverse o interactuar.
- Menú contextual saliendo del objeto/tile.
- HUD inferior: mano izquierda, teletipo de pensamientos, vida, energía, mano derecha.
- Click en personaje para abrir inventario/estado.
- Inventario físico 4x4; fila superior como manos.
- Objetos físicos no apilables; drag & drop entre inventario y mundo; soltar en el suelo.
- Pilas simples de objetos similares.
- Recolección básica; primeras combinaciones ocultas.
- Pensamientos en primera persona.
- Primer bloqueo natural: jungla espesa.
- Primer desbloqueo: despejar un tile de jungla.

### No incluye todavía

Multiplayer · bases visitables · gremios · economía · enseñanza entre jugadores ·
máquinas complejas · automatización offline · combate · hambre compleja · clima ·
NPCs · biomas grandes · caves/dungeons · guardado en servidor · mercado · misiones
formales · árbol tecnológico completo.

## Relacionado

- [Experiencia del MVP (20 min)](experiencia-20min.md)
- [Criterios de éxito del MVP](criterios-exito.md)
- [Secuencia mínima testeable](criterios-exito.md#secuencia-mínima-testeable)
- [Regla de oro del MVP](../2-dominio/reglas-de-expansion.md#regla-de-oro-del-mvp)
- [Separación back/front: implicancias para el MVP](../3-backend-api/separacion-backend-frontend.md#implicancias-para-el-mvp)
