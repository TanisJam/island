# Responsabilidades del frontend

> Propuesta arquitectónica (no parte de los documentos originales). Define el límite
> del cliente para que sea **reemplazable** por otra tecnología sin tocar la lógica
> de juego. Ver [separación back/front](../3-backend-api/separacion-backend-frontend.md).

## Qué hace el frontend

1. **Render del mundo**: tiles, objetos, personaje, pilas, construcciones, según el
   snapshot de la zona y el estado de visibilidad
   (`unseen` / `explored` / `visible`).
2. **Captura de input** (mouse-only): primer click = observar/seleccionar; segundo
   click = mover o ejecutar; drag & drop; click en personaje (menú); click en
   teletipo (historial). Ver [control mouse-only](../1-diseno/control-mouse.md).
3. **HUD**: manos izquierda/derecha, teletipo de pensamientos, vida, energía. Ver
   [UI / HUD](../1-diseno/ui-hud.md).
4. **Predicción local** de lo latency-sensitive:
   - observación/selección (100% local, sin red);
   - movimiento por tile (predice y reconcilia);
   - *preview* del menú contextual con la copia de reglas que entrega el backend.
5. **Reconciliación**: aplica los eventos que devuelve el backend y corrige
   cualquier predicción optimista que haya divergido.

## Qué NO hace el frontend

- No decide el **resultado** de una acción ni de una combinación oculta (lo valida
  el backend; anti-cheat).
- No es dueño del estado persistente: siempre parte del snapshot del backend.
- No inventa acciones contextuales: sólo recalcula el preview de las que el backend
  habilitó.
- No genera IDs reales de entidades.

## Por qué esto permite "fronts en distintas tecnologías"

Toda la lógica de juego (reglas, efectos, progresión, persistencia) vive en el
backend y se expone como **data + comandos/eventos**. Un nuevo front sólo necesita:

1. consumir `GET /catalog`, `GET /zones/{id}`, `GET /players/{id}/state`;
2. renderizar ese estado con su propia tecnología;
3. mandar `POST /commands` y aplicar los `Event[]` resultantes.

Nada de gameplay se reimplementa por front. Lo único específico de cada cliente es
**presentación** (sprites, layout, animación) y **predicción** (optimización de
*feel*).

## Targets y especificaciones (decidido)

✅ **Targets (A6):** web, móvil y una plataforma cerrada que corre **webview**. El
contrato es agnóstico (JSON sobre HTTP/WS), así que ningún front filtra detalles de
UI al backend.

✅ **Movimiento (B5):** **snap por tile** (no continuo en píxeles) por ahora.
Simplifica pathfinding y predicción.

✅ **Arte y tamaños (D1–D2):** arte **propio** (tilesets existentes sólo como
referencia). Tile base **16x16 px**, escalado en juego **x3 o x4**.

| Asset | Tamaño base |
|---|---|
| Tile | 16x16 |
| Objeto chico | 16x16 |
| Objeto mediano | 16x32 / 32x32 |
| Personaje | 16x24 / 24x32 |
| Íconos UI | 16x16 / 24x24 |

## Relacionado

- [Separación backend / frontend](../3-backend-api/separacion-backend-frontend.md)
- [Control mouse-only](../1-diseno/control-mouse.md)
- [UI / HUD](../1-diseno/ui-hud.md)
- [Presentación visual](../1-diseno/presentacion-visual.md)
