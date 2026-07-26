// src/demoTransport.js — replays a recorded timeline through the Board's transport seam. No network.
export function makeDemoTransport(timeline, { speed = 1 } = {}) {
  const stepMs = Math.max(30, timeline.step_seconds * 1000 / speed);
  let current = new Map(timeline.frames[0].boards.map((b) => [b.patient_id, b]));

  return {
    async fetchBoard() { return timeline.frames[0].boards; },

    openStream(_token, onUpdate, onStatus = () => {}) {
      onStatus("open");
      const timers = timeline.frames.slice(1).map((frame) =>
        setTimeout(() => {
          for (const b of frame.boards) { current.set(b.patient_id, b); onUpdate(b); }
        }, frame.t * stepMs));
      return () => timers.forEach(clearTimeout);
    },

    openNotifications(_token, role, onNotify) {
      const timers = timeline.frames.map((frame) =>
        setTimeout(() => frame.notifications.filter((n) => n.audience === role).forEach(onNotify),
                   frame.t * stepMs));
      return () => timers.forEach(clearTimeout);
    },

    async ackAlert(_token, patientId, kind, role) {
      const board = current.get(patientId);
      const updated = { ...board, alerts: board.alerts.map((a) =>
        a.kind === kind ? { ...a, acknowledged: true, acknowledged_by: role,
                            acknowledged_at: new Date().toISOString(), escalated: false } : a) };
      current.set(patientId, updated);
      return updated;
    },

    async fetchAudit(_token, { eventType } = {}) {
      return eventType === "notification" ? timeline.notification_history : [];
    },

    recordView() {},
  };
}
