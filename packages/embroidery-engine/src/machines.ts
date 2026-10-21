/**
 * Multi-machine object assignment.
 *
 * Production shops split a job across machines by colour block or by
 * component. The document stores a 1-based machine number on each object; this
 * module turns that convention into deterministic groups and a filenames-safe
 * summary. Exporters compile each group separately, which keeps every machine
 * file independently valid instead of embedding one machine's objects as
 * jumps in another's file.
 */

import type { EmbroideryObject } from './types.js';

export const MAX_MACHINES = 64;

export function machineOf(object: EmbroideryObject): number {
  const value = object.machine ?? 1;
  return Number.isFinite(value) ? Math.min(MAX_MACHINES, Math.max(1, Math.round(value))) : 1;
}

export function machineNumbers(objects: EmbroideryObject[]): number[] {
  const numbers = new Set<number>();
  for (const object of objects) numbers.add(machineOf(object));
  return Array.from(numbers).sort((a, b) => a - b);
}

/** Group visible objects by machine, preserving their original order. */
export function splitObjectsByMachine(objects: EmbroideryObject[]): Map<number, EmbroideryObject[]> {
  const groups = new Map<number, EmbroideryObject[]>();
  for (const object of objects) {
    const machine = machineOf(object);
    const list = groups.get(machine);
    if (list) list.push(object);
    else groups.set(machine, [object]);
  }
  return new Map(Array.from(groups.entries()).sort(([a], [b]) => a - b));
}

/**
 * Suggest additional machines until every machine has at most one object.
 * Used by the "spread across machines" action so a bulk assignment has a
 * predictable, repeatable result.
 */
export function spreadAcrossMachines(objects: EmbroideryObject[]): EmbroideryObject[] {
  const total = Math.max(1, Math.min(MAX_MACHINES, objects.length));
  return objects.map((object, index) => ({ ...object, machine: (index % total) + 1 }));
}
