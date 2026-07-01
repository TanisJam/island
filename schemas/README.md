# Schemas — contrato validable y generador de tipos

JSON Schema (**draft-07**) del contrato de Isla Misteriosa. Una sola fuente de verdad
que el **backend** usa para validar y de la que **cualquier front** (web, móvil,
webview) genera tipos. Semántica narrada en
[`docs/3-backend-api/`](../docs/3-backend-api/).

## Por qué draft-07

Es el denominador común de las herramientas de codegen multi-lenguaje:
`json-schema-to-typescript` (TS), `quicktype` (Swift, Kotlin, Dart, C#…) y los
validadores (`ajv`). Evita features de 2019-09/2020-12 que algunos generadores aún no
soportan.

## Archivos

| Archivo | Cubre | Raíz |
|---|---|---|
| `common.json` | primitivos + entidades de dominio (Position, TargetRef, Location, ItemInstance, Tile, WorldObject, Pile, Player, Zone, Thought…) | — (sólo `definitions`) |
| `catalog.json` | `GET /catalog`: TerrainTypeDef, ItemTypeDef, WorldObjectTypeDef, KnowledgeDef, **ContextActionDef** (TargetSelector / Requirement / InputSpec / Effect), ResearchDef | `Catalog` |
| `commands.json` | `POST /commands`: las 7 intenciones + `CommandEnvelope` | `CommandEnvelope` |
| `events.json` | respuesta: los 19 eventos + `Rejection` + `CommandResult` | `CommandResult` |

Los `$ref` entre archivos son por **nombre de archivo relativo** (`common.json#/...`);
no hay `$id` con URL, así que resuelven igual en disco (codegen) y en memoria (ajv).

## Uso

```bash
pnpm install
pnpm validate     # valida ../catalog real + fixtures contra los schemas (ajv)
pnpm gen          # genera generated/*.ts (json-schema-to-typescript)
```

`pnpm validate` falla con código ≠ 0 si el catálogo o un fixture no cumplen → sirve
para CI.

## Tipos generados

`pnpm gen` escribe en [`generated/`](generated/) tipos TypeScript con uniones
discriminadas limpias (`Command`, `Effect`, `Event`, etc.). Están commiteados por
conveniencia; se regeneran con el comando. **No editar a mano** (tienen banner
`AUTOGENERADO`).

### Otros lenguajes (Swift / Kotlin / Dart…)

```bash
pnpm dlx quicktype -s schema schemas/catalog.json -o Catalog.swift   # o -l kotlin, dart, ...
```

> Nota de implementación: `json-schema-to-typescript` no soporta `$ref` en la raíz de
> un schema; por eso el codegen (`codegen.cjs`) hace `bundle()` para resolver
> `common.json` y promueve el `$ref` raíz antes de generar. ajv valida los schemas tal
> cual, sin pre-proceso.

## Versionado

El `catalogVersion` vive en [`../catalog/meta.json`](../catalog/meta.json), no en estos
schemas. Estos describen la **forma**; el catálogo describe el **contenido**.

## Relacionado

- [Contrato de API](../docs/3-backend-api/contrato-api.md)
- [Catálogo (esquema narrado)](../docs/3-backend-api/catalogo.md)
- [Comandos y eventos](../docs/3-backend-api/comandos-eventos.md)
- [Contenido del catálogo](../catalog/)
