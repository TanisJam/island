/** Shared render constants, extracted from `canvas.ts` so renderer-agnostic
 * modules (`camera.ts`) don't depend on the Canvas renderer module. This is
 * prep work for the Canvas -> Pixi swap (SDD "animations-lighting" WU0):
 * severing this coupling lets `canvas.ts` be deleted later without touching
 * `camera.ts`. */

export const TILE = 16;
export const SCALE = 3;
export const PX = TILE * SCALE; // 48px/tile
