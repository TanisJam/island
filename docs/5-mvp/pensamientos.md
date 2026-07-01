# MVP — Sistema de pensamientos

> Fuente: MVP Systems Spec §8. Diseño general en
> [sistema de pensamientos](../1-diseno/pensamientos.md).

## Regla principal

Todo feedback importante debe ser en **primera persona**. No usar mensajes técnicos.

## Tipos de pensamientos

```ts
type ThoughtKind =
  | "observation"
  | "idea"
  | "discovery"
  | "warning"
  | "failure"
  | "memory"
  | "system"
```

## Estructura

```ts
type Thought = {
  id: string
  text: string
  kind: ThoughtKind
  timestamp: number
  relatedEntityId?: string
  relatedSystem?: string
}
```

## Ejemplos por tipo

| Tipo | Ejemplo |
|---|---|
| Observation | "Veo ramas secas al alcance." |
| Idea | "Tal vez pueda atar la piedra a una rama." |
| Discovery | "No es una gran herramienta, pero es mejor que mis manos." |
| Warning | "La vegetación es demasiado cerrada para pasar así." |
| Failure | "No funcionó, pero ahora sé que la fibra se quema muy rápido." |
| Memory | "Desperté en esta playa después de la tormenta." |
| System (narrativo) | "No tengo espacio para acomodar eso." |

> Responsabilidad del `ThoughtSystem`: registrar pensamiento, mostrar el último en el
> teletipo, abrir historial y **evitar repetir** mensajes idénticos seguidos.

## Relacionado

- [Sistema de pensamientos (GDD)](../1-diseno/pensamientos.md)
- [Lista inicial de pensamientos](pensamientos-iniciales.md)
- [HUD — teletipo](control-hud.md#teletipo)
