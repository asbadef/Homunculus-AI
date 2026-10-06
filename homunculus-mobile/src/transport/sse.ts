/**
 * Incremental SSE (Server-Sent Events) parser.
 *
 * The server emits these frames (see `homunculus-engine/src/homunculus/api/app.py`,
 * `sse_board_frames` / `sse_notification_frames`):
 *   - `data: {json}\n\n`   — a payload event (unnamed: the SSE spec's `message`)
 *   - `: keep-alive\n\n`   — a comment, sent to keep the connection alive while idle
 *   - `event: heartbeat\ndata: {}\n\n` — a NAMED event (the board stream, while idle), by which a
 *     browser's EventSource tells a quiet stream from a dead one. Not a payload: like
 *     EventSource's `onmessage`, this parser yields only unnamed (or `message`) events.
 *
 * A streamed fetch delivers these as raw decoded text chunks that can split anywhere — mid
 * line, mid `\n\n` terminator, even mid-JSON. This module owns reassembling that byte stream
 * into complete events so the transport layer (Task 3) never has to think about partial data.
 *
 * The parser is intentionally pure: no fetch, no timers, no React, no I/O. It is a plain
 * `push(chunk) -> payloads[]` state machine, which keeps it trivially unit-testable and lets
 * the transport own all the async plumbing around it.
 */

export interface SseParserOptions {
  /** Called with the raw data payload that failed JSON.parse; parsing continues. */
  onError?: (raw: string) => void;
}

export interface SseParser {
  /** Feed one decoded chunk; returns every complete event payload it finished. */
  push(chunk: string): unknown[];
}

export function createSseParser(options: SseParserOptions = {}): SseParser {
  const { onError } = options;

  // Trailing partial line carried over between pushes.
  let buffer = "";
  // Lines accumulated for the event currently being assembled.
  let dataLines: string[] = [];
  // The `event:` field of the event being assembled; "" is the spec's default, `message`.
  let eventName = "";

  function finishEvent(results: unknown[]): void {
    const name = eventName;
    eventName = "";
    if (dataLines.length === 0) return;
    const raw = dataLines.join("\n");
    dataLines = [];
    // A named event (the board stream's heartbeat) is not a payload.
    if (name !== "" && name !== "message") return;
    try {
      results.push(JSON.parse(raw));
    } catch {
      onError?.(raw);
    }
  }

  return {
    push(chunk: string): unknown[] {
      const results: unknown[] = [];

      buffer += chunk;
      const lines = buffer.split("\n");
      // The last element is either "" (buffer ended on a newline) or a partial line still
      // awaiting more data; either way it is not a complete line yet, so hold it back.
      buffer = lines.pop() ?? "";

      for (let line of lines) {
        // CRLF safety: strip a trailing \r left over from a \r\n terminator.
        if (line.endsWith("\r")) line = line.slice(0, -1);

        if (line === "") {
          // Blank line: end of event.
          finishEvent(results);
        } else if (line.startsWith(":")) {
          // Comment (e.g. keep-alive) — ignored.
        } else if (line.startsWith("data:")) {
          let value = line.slice("data:".length);
          // Per the SSE spec, strip at most one leading space after the colon.
          if (value.startsWith(" ")) value = value.slice(1);
          dataLines.push(value);
        } else if (line.startsWith("event:")) {
          let value = line.slice("event:".length);
          if (value.startsWith(" ")) value = value.slice(1);
          eventName = value;
        }
        // Other fields (id:, retry:) are ignored — the server never sends them.
      }

      return results;
    },
  };
}
