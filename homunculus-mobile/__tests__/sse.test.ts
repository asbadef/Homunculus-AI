/// <reference types="jest" />
import { createSseParser } from "../src/transport/sse";

describe("createSseParser", () => {
  it("yields one parsed payload per data event", () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\n\n')).toEqual([{ a: 1 }]);
  });

  it("accumulates a payload split across chunk boundaries", () => {
    const p = createSseParser();
    expect(p.push('data: {"a"')).toEqual([]);
    expect(p.push(':1}\n')).toEqual([]);
    expect(p.push("\n")).toEqual([{ a: 1 }]);
  });

  it("yields multiple events arriving in one chunk", () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\n\ndata: {"b":2}\n\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("ignores keep-alive comments", () => {
    const p = createSseParser();
    expect(p.push(": keep-alive\n\n")).toEqual([]);
  });

  it("joins multi-line data fields with newlines per the SSE spec", () => {
    const p = createSseParser();
    expect(p.push('data: {"a":\ndata: 1}\n\n')).toEqual([{ a: 1 }]);
  });

  it("reports malformed JSON to onError and keeps parsing", () => {
    const errors: string[] = [];
    const p = createSseParser({ onError: (raw) => errors.push(raw) });
    expect(p.push("data: not-json\n\ndata: {\"ok\":true}\n\n")).toEqual([{ ok: true }]);
    expect(errors).toEqual(["not-json"]);
  });

  // Extra cases below: real behaviours a streamed fetch over the wire genuinely produces.

  it("handles CRLF line endings (some proxies/servers normalize to \\r\\n)", () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\r\n\r\n')).toEqual([{ a: 1 }]);
  });

  it("survives a chunk boundary that falls exactly between the two terminating newlines", () => {
    const p = createSseParser();
    expect(p.push('data: {"a":1}\n')).toEqual([]);
    expect(p.push("\n")).toEqual([{ a: 1 }]);
  });

  it("handles a data: line with no space after the colon (spec strips at most one leading space)", () => {
    const p = createSseParser();
    expect(p.push('data:{"a":1}\n\n')).toEqual([{ a: 1 }]);
  });

  it("keeps buffering keep-alive comments and real events interleaved across many small chunks", () => {
    const p = createSseParser();
    expect(p.push(":")).toEqual([]);
    expect(p.push(" keep-alive\n")).toEqual([]);
    expect(p.push("\ndata: ")).toEqual([]);
    expect(p.push('{"a"')).toEqual([]);
    expect(p.push(":1}")).toEqual([]);
    expect(p.push("\n\n")).toEqual([{ a: 1 }]);
  });
});
