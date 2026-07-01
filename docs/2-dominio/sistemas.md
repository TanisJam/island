# Sistemas

> Fuente: GDD v2 §29 (arquitectura sistémica recomendada) y MVP Spec §26
> (implementación modular sugerida).

Aunque la tecnología final pueda variar, el juego debe separarse en módulos desde el
principio. Cada sistema tiene una responsabilidad clara. Esto es lo que vive en el
**backend autoritativo** (ver [separación back/front](../3-backend-api/separacion-backend-frontend.md)).

## Mapa de sistemas (visión completa — GDD §29)

| Sistema | Responsable de |
|---|---|
| **World System** | tiles, objetos del mundo, zonas, navegación, bloqueos, recursos |
| **Visibility System** | radio de visión, tiles vistos/explorados, objetos ocultos, actualización al moverse |
| **Interaction System** | detectar target, calcular acciones, elegir acción principal, validar distancia, ejecutar efectos, generar pensamientos |
| **Inventory System** | grillas, formas, rotación, drag & drop, manos, contenedores, validación de espacio |
| **Item System** | tipos de item, instancias, propiedades, durabilidad, ubicación, transformación |
| **Thought System** | generar mensajes, mantener historial, filtrar, mostrar teletipo, asociar pensamientos con eventos |
| **Research System** | hipótesis, nodos, progreso, revelado, contribuciones por propiedades, desbloqueos |
| **Technique System** | técnicas conocidas, experiencia, niveles, aprendizaje por práctica, enseñanza |
| **Machine System** | estaciones, máquinas, slots, procesos temporizados, input/output, combustible, eficiencia, mejoras |
| **Base System** | objetos colocados, permisos, estructuras, layout, persistencia del campamento |
| **Async Social System** | visitas, acciones offline, permisos, tarifas, logs, enseñanza, uso de máquinas ajenas |
| **Progression System** | desbloqueos y avance por eras |

## Módulos del MVP (MVP Spec §26)

El MVP usa un subconjunto. `GameState` es el agregado de runtime (ver
[modelo de datos](modelo-de-datos.md#estado-global-referencia-de-implementación)).

| Módulo MVP | Responsable de |
|---|---|
| **GameState** | estado central (player, world, inventories, items, piles, thoughts, knowledge, target) |
| **WorldSystem** | tiles, objetos, zona |
| **VisibilitySystem** | radio de visión, vistos/explorados/ocultos |
| **InputSystem** | click en tile/objeto/personaje, drag start/drop, doble click o segundo click, selección actual |
| **InteractionSystem** | calcular acciones contextuales, elegir acción principal, validar distancia, ejecutar efectos, generar pensamientos |
| **InventorySystem** | validar espacio, mover items, detectar manos, drag & drop, inventario↔mundo |
| **ItemSystem** | tipos, instancias, propiedades, transformación |
| **ThoughtSystem** | registrar pensamiento, mostrar último en teletipo, abrir historial, evitar repetir mensajes idénticos |
| **CraftingDiscoverySystem** | detectar combinaciones por contexto, desbloquear conocimientos, crear nuevos items, no mostrar recetas exactas |
| **EnergySystem** | costos por acción, recuperación |
| **PersistenceSystem** | *opcional* en MVP |

> **Nota de frontera:** `InputSystem` es el único que naturalmente vive (también) en
> el cliente. El resto es lógica de juego autoritativa del backend. Ver
> [responsabilidades del frontend](../4-frontend/responsabilidades-frontend.md).

## Relacionado

- [Modelo de datos](modelo-de-datos.md)
- [Interacción contextual](interaccion-contextual.md)
- [Separación backend / frontend](../3-backend-api/separacion-backend-frontend.md)
