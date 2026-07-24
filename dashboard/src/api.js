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

// Opens the role-filtered notification stream. Calls onNotify(notification) per event.
// Returns a close() function.
export function openNotifications(token, role, onNotify) {
  if (typeof EventSource === "undefined") return () => {};   // no SSE (e.g. jsdom) -> no-op
  const es = new EventSource(
    `/notifications?token=${encodeURIComponent(token)}&role=${encodeURIComponent(role)}`);
  es.onmessage = (e) => { try { onNotify(JSON.parse(e.data)); } catch { /* keep-alive */ } };
  return () => es.close();
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
