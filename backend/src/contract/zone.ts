// AUTOGENERADO desde schemas/zone.json — no editar a mano.

export interface ZoneTemplate {
  width: number;
  height: number;
  tiles: string[];
  objects: ZoneObjectPlacement[];
}
export interface ZoneObjectPlacement {
  objectTypeId: string;
  x: number;
  y: number;
  state?: {};
}
