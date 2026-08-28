// What the board is allowed to show, given the state of the connection.
//
// The distinction this file exists to enforce: "connected, and there are no patients" and
// "we cannot reach the backend" must never render the same way. An empty patient list reads as
// nobody needing attention — the most reassuring screen the system can draw — and displaying it
// while monitoring has actually stopped would be a lie told at the worst possible moment.
//
// Falling back to simulated data on failure is likewise forbidden: whatever this returns while
// unavailable is empty, and the screen says why.

export const CONNECTION = {
  CONNECTING: "connecting",
  LIVE: "live",
  DEGRADED: "degraded",
  UNAVAILABLE: "unavailable",
};

export function nextConnection(current, event) {
  switch (event?.type) {
    case "start":       return CONNECTION.CONNECTING;
    case "loaded":      return CONNECTION.LIVE;
    case "stream-open": return CONNECTION.LIVE;
    case "stream-lost": return CONNECTION.DEGRADED;
    case "failed":      return CONNECTION.UNAVAILABLE;
    default:            return current ?? CONNECTION.CONNECTING;
  }
}

export function boardView(connection, patients) {
  if (connection === CONNECTION.UNAVAILABLE) {
    return {
      showList: false,
      patients: [],
      isError: true,
      notice: "Sunucuya bağlantı yok — hasta listesi gösterilmiyor. "
            + "Bu ekran hasta olmadığı anlamına GELMEZ.",
    };
  }

  if (connection === CONNECTION.CONNECTING) {
    return { showList: false, patients: [], isError: false, notice: "Bağlanılıyor…" };
  }

  const list = patients ?? [];
  const degraded = connection === CONNECTION.DEGRADED;

  let notice = null;
  if (degraded) {
    notice = "Canlı akış koptu — veriler düzenli aralıklarla yenileniyor.";
  } else if (list.length === 0) {
    notice = "Şu anda izlenen hasta yok. Bağlantı çalışıyor.";
  }

  return { showList: true, patients: list, isError: false, notice };
}
