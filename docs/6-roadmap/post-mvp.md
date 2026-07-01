# Post-MVP

> Fuente: MVP Systems Spec §28 y §29. Qué viene una vez validado el primer vertical
> slice (Fases 1-5 del [roadmap modular](roadmap-modular.md)).

## Próximos pasos después del MVP

### MVP 0.2 — Base física

mesa con superficie real · fogata con combustible · contenedores · más pilas ·
primeros procesos temporizados.

### MVP 0.3 — Investigación

cuaderno · nodos de investigación · contención de calor · barro · carbón ·
horno primitivo.

### MVP 0.4 — Primeras máquinas

molino manual · triturador rudimentario · horno primitivo · inputs/outputs.

> ✅ **Decidido (D3):** los procesos temporizados se resuelven **lazy** al cargar la
> zona (delta de tiempo), no con scheduler permanente.

### MVP 0.5 — Social asincrónico

visitar base · usar fogata/mesa/horno ajeno · permisos básicos · registro de visitas.

> ✅ **Decidido (A4):** a partir de la capa social se introduce **tiempo real** sólo
> para jugadores en la **misma zona** (transporte WebSocket; el modelo comando→evento
> se mantiene).

## Regla de oro del MVP

> Fuente: MVP Systems Spec §29.

Cada cosa implementada debe reforzar al menos una de estas ideas:

```
Estoy en un mundo físico.
Mis manos importan.
Mirar me ayuda a entender.
Los objetos tienen forma y peso.
El campamento es parte del inventario.
El descubrimiento nace de probar con sentido.
Las herramientas cambian mi relación con la isla.
La isla se abre de manera orgánica.
```

Si una feature no refuerza ninguna de esas ideas, no pertenece al MVP. (Esta regla
también está enlazada desde [reglas de expansión](../2-dominio/reglas-de-expansion.md#regla-de-oro-del-mvp).)

## Relacionado

- [Roadmap modular](roadmap-modular.md)
- [Multiplayer, gremios y economía (GDD)](../1-diseno/social-economia.md)
- [Máquinas y base (GDD)](../1-diseno/maquinas-base.md)
- [Separación backend / frontend](../3-backend-api/separacion-backend-frontend.md)
