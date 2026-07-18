// Thin transport wrapper. Tenant bearer token: header for the snapshot, query param for SSE
// (browsers cannot set headers on EventSource).
export async function fetchBoard(token) {
  const res = await fetch("/patients", { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET /patients failed: ${res.status}`);
  const body = await res.json();
  return body.patients;
}

// Opens the SSE stream. Calls onUpdate(patientBoard) for each event and onStatus("open"|"error").
// Returns a close() function.
export function openStream(token, onUpdate, onStatus = () => {}) {
  const source = new EventSource(`/stream?token=${encodeURIComponent(token)}`);
  source.onopen = () => onStatus("open");
  source.onerror = () => onStatus("error"); // EventSource auto-reconnects
  source.onmessage = (e) => onUpdate(JSON.parse(e.data));
  return () => source.close();
}
