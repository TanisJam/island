# Isla Misteriosa — Documentación

Supervivencia, descubrimiento, crafting físico y automatización social asincrónica.
Juego de navegador, pixel art, top-down, mouse-only, multiplayer asincrónico.

Esta documentación es la bajada a `.md` del **Game Design Document v2** y del
**MVP Systems Spec v0.1**, reorganizada **por capas / dominio** para soportar un
desarrollo con **backend autoritativo y frontend(s) intercambiables**.

> Fuentes originales (no borrar): `../Isla Misteriosa - Game Design Document.pdf`
> y `../MVP Systems Spec - Isla Misteriosa.pdf`.

---

## Cómo está organizado

| Carpeta | Qué contiene | Para quién |
|---|---|---|
| [`0-vision/`](0-vision/) | Fantasía, pilares de diseño, experiencia objetivo | Todos |
| [`1-diseno/`](1-diseno/) | UX y reglas de juego: control, HUD, crafting, mundo, social | Diseño / Front / Back |
| [`2-dominio/`](2-dominio/) | Modelo de datos, sistemas y reglas (el corazón del backend) | Backend |
| [`3-backend-api/`](3-backend-api/) | Autoridad + **contrato**: catálogo, comandos y eventos | Backend / Front |
| [`4-frontend/`](4-frontend/) | Responsabilidades del cliente: render, input, predicción | Front |
| [`5-mvp/`](5-mvp/) | Alcance del primer vertical slice jugable | Todos |
| [`6-roadmap/`](6-roadmap/) | Fases modulares y pasos post-MVP | Producto |
| [`PREGUNTAS.md`](PREGUNTAS.md) | **Dudas abiertas y decisiones pendientes** | Todos |

## Orden de lectura sugerido

1. [Resumen](0-vision/01-resumen.md) → [Pilares](0-vision/02-pilares.md) → [Experiencia objetivo](0-vision/03-experiencia-objetivo.md)
2. [Modelo de datos](2-dominio/modelo-de-datos.md) → [Sistemas](2-dominio/sistemas.md) → [Interacción contextual](2-dominio/interaccion-contextual.md)
3. [Separación backend / frontend](3-backend-api/separacion-backend-frontend.md) (decisión arquitectónica central)
4. **Contrato:** [API](3-backend-api/contrato-api.md) → [Catálogo](3-backend-api/catalogo.md) → [Comandos y eventos](3-backend-api/comandos-eventos.md)
5. [MVP: objetivo y alcance](5-mvp/objetivo-alcance.md)
6. [PREGUNTAS.md](PREGUNTAS.md) antes de codear nada serio

## Artefactos fuera de `docs/`

- [`/catalog`](../catalog/) — contenido data-driven del MVP (lo que sirve `GET /catalog`).
- [`/schemas`](../schemas/) — JSON Schema del contrato: valida el catálogo y genera tipos para cualquier front.

## Principio rector del proyecto

> El jugador empezó como náufrago indefenso y terminó construyendo una base
> funcional. La progresión NO se basa en seguir un libro de recetas, sino en
> **mirar, probar, fallar, aprender y mejorar**.

La meta no es que el jugador complete una lista. La meta es que pueda decir:
**"Entiendo mejor la isla que ayer."**

## Decisión arquitectónica que atraviesa todo

El backend es **autoritativo del estado persistente y de las reglas**; el frontend
es una **vista predictiva** que se puede reimplementar en distintas tecnologías
(web/canvas, nativo, etc.) sin tocar la lógica de juego. El detalle, los límites y
las tensiones de latencia están en
[`3-backend-api/separacion-backend-frontend.md`](3-backend-api/separacion-backend-frontend.md).
