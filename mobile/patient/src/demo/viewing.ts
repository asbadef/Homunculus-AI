// "Viewing as a family member" mode. Switches the active demo patient and remembers the
// owner so you can return. A tiny subscribable store so a global banner can react.
import { currentPatient, setCurrentPatient } from "./patients";

let ownerId: string | null = null;
let viewingName: string | null = null;
const listeners = new Set<() => void>();

function emit() { listeners.forEach((l) => l()); }

export function subscribeViewing(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function viewAs(patientId: string, name: string): void {
  if (!ownerId) ownerId = currentPatient().id;
  setCurrentPatient(patientId);
  viewingName = name;
  emit();
}

export function returnToSelf(): void {
  if (ownerId) { setCurrentPatient(ownerId); ownerId = null; }
  viewingName = null;
  emit();
}

export function getViewingName(): string | null {
  return viewingName;
}
