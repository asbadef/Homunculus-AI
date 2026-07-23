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

// Acknowledge an alert. Returns the updated patient board.
export async function ackAlert(token, patientId, kind, role) {
  const res = await fetch("/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ patient_id: patientId, kind, role }),
  });
  if (!res.ok) throw new Error(`POST /ack failed: ${res.status}`);
  return res.json();
}
