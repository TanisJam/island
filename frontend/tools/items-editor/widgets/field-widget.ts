/**
 * The uniform field-widget contract (design.md "1. Chosen architecture —
 * the uniform widget contract (the crux of making main.ts generic)").
 * Existing widgets have heterogeneous APIs
 * (`TextFieldWidget.getValue():string`, `NumberFieldWidget.getRawValue()`,
 * `PropsFieldWidget.getValue():Record<string,number>`); `widgets/adapters.ts`
 * wraps each in this shape so `engine.ts` can loop over a `CollectionDescriptor`
 * with ZERO per-kind branching.
 *
 * Kept in its own file (no DOM/adapter logic) so `widgets/registry.ts`,
 * `widgets/adapters.ts`, `widgets/enum-field.ts`, and `engine.ts` can all
 * import just the types without any import-order coupling.
 */

/** `undefined` means "omit this optional field from the reconstructed record". */
export interface ParseOk {
  ok: true;
  value: unknown | undefined;
}
export interface ParseErr {
  ok: false;
  message: string;
}
export type FieldParseResult = ParseOk | ParseErr;

export interface FieldWidget {
  root: HTMLElement;
  read(): FieldParseResult;
  write(value: unknown): void;
  setError(message: string | null): void;
  onChange(cb: () => void): void;
  focus(): void;
}
