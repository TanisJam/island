import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBooleanFieldAdapter,
  createNumberFieldAdapter,
  createNumberMapFieldAdapter,
  createTagsFieldAdapter,
  createTextFieldAdapter,
} from "./adapters";
import type { TextFieldWidget } from "./text-field";
import type { NumberFieldWidget } from "./number-field";
import type { BooleanFieldWidget } from "./boolean-field";
import type { TagsFieldWidget } from "./tags-field";
import type { PropsFieldWidget } from "./props-field";

/**
 * Adapter tests use hand-rolled in-memory fakes (not real DOM widgets —
 * this project has no DOM test environment, matching the existing
 * convention of only unit-testing the PURE logic behind each widget, e.g.
 * `text-field.test.ts` tests `emptyToUndefined` directly rather than
 * `createTextField()`). Each fake implements the exact widget interface so
 * the adapter's `read()`/`write()` round-trip is exercised for real.
 */
const fakeRoot = {} as unknown as HTMLElement;

function fakeTextField(initial = ""): TextFieldWidget {
  let value = initial;
  return {
    root: fakeRoot,
    getValue: () => value,
    setValue: (v) => {
      value = v;
    },
    setError: () => {},
    onChange: () => {},
    focus: () => {},
  };
}

function fakeNumberField(initial = ""): NumberFieldWidget {
  let raw = initial;
  return {
    root: fakeRoot,
    getRawValue: () => raw,
    setValue: (v) => {
      raw = v === undefined ? "" : String(v);
    },
    setError: () => {},
    onChange: () => {},
    focus: () => {},
  };
}

function fakeBooleanField(initial = false): BooleanFieldWidget {
  let value = initial;
  return {
    root: fakeRoot,
    getValue: () => value,
    setValue: (v) => {
      value = v;
    },
    onChange: () => {},
  };
}

function fakeTagsField(initial: string[] = []): TagsFieldWidget {
  let value = initial;
  return {
    root: fakeRoot,
    getValue: () => [...value],
    setValue: (v) => {
      value = [...v];
    },
    setError: () => {},
    onChange: () => {},
  };
}

function fakePropsField(initial: Record<string, number> = {}): PropsFieldWidget {
  let value = initial;
  return {
    root: fakeRoot,
    getValue: () => ({ ...value }),
    setValue: (v) => {
      value = { ...v };
    },
    setError: () => {},
    onChange: () => {},
  };
}

// --- text adapter -----------------------------------------------------------

test("text adapter: required + empty fails", () => {
  const adapter = createTextFieldAdapter(fakeTextField(""), { required: true });
  assert.deepEqual(adapter.read(), { ok: false, message: "This field is required" });
});

test("text adapter: optional + empty returns ok with value undefined (omit on save)", () => {
  const adapter = createTextFieldAdapter(fakeTextField(""), { required: false });
  assert.deepEqual(adapter.read(), { ok: true, value: undefined });
});

test("text adapter: a valid value round-trips through write -> read", () => {
  const widget = fakeTextField();
  const adapter = createTextFieldAdapter(widget, { required: true });
  adapter.write("Atar");
  assert.deepEqual(adapter.read(), { ok: true, value: "Atar" });
});

// --- number adapter -----------------------------------------------------------

test("number adapter: required + empty fails", () => {
  const adapter = createNumberFieldAdapter(fakeNumberField(""), { required: true });
  assert.equal(adapter.read().ok, false);
});

test("number adapter: optional + empty returns ok with value undefined", () => {
  const adapter = createNumberFieldAdapter(fakeNumberField(""), { required: false });
  assert.deepEqual(adapter.read(), { ok: true, value: undefined });
});

test("number adapter: a valid value round-trips through write -> read", () => {
  const widget = fakeNumberField();
  const adapter = createNumberFieldAdapter(widget, { required: true, min: 1, integer: true });
  adapter.write(3);
  assert.deepEqual(adapter.read(), { ok: true, value: 3 });
});

// --- boolean adapter -----------------------------------------------------------

test("boolean adapter: always ok — false is a valid value, not an error", () => {
  const adapter = createBooleanFieldAdapter(fakeBooleanField(false));
  assert.deepEqual(adapter.read(), { ok: true, value: false });
});

test("boolean adapter: a value round-trips through write -> read", () => {
  const widget = fakeBooleanField(false);
  const adapter = createBooleanFieldAdapter(widget);
  adapter.write(true);
  assert.deepEqual(adapter.read(), { ok: true, value: true });
});

// --- tags adapter -----------------------------------------------------------

test("tags adapter: an empty array is always ok (not a required-empty failure)", () => {
  const adapter = createTagsFieldAdapter(fakeTagsField([]));
  assert.deepEqual(adapter.read(), { ok: true, value: [] });
});

test("tags adapter: a value round-trips through write -> read", () => {
  const widget = fakeTagsField();
  const adapter = createTagsFieldAdapter(widget);
  adapter.write(["fire", "blocker"]);
  assert.deepEqual(adapter.read(), { ok: true, value: ["fire", "blocker"] });
});

// --- numberMap (props) adapter -----------------------------------------------

test("numberMap adapter: an empty object is always ok (not a required-empty failure)", () => {
  const adapter = createNumberMapFieldAdapter(fakePropsField({}));
  assert.deepEqual(adapter.read(), { ok: true, value: {} });
});

test("numberMap adapter: a value round-trips through write -> read", () => {
  const widget = fakePropsField();
  const adapter = createNumberMapFieldAdapter(widget);
  adapter.write({ hardness: 2 });
  assert.deepEqual(adapter.read(), { ok: true, value: { hardness: 2 } });
});
