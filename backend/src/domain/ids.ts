import { randomUUID } from "node:crypto";

/** IDs los genera siempre el backend (decisión B5). */
export const newId = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;
