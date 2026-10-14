import { writeSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { writeSqliteWorkerResponse } from "./sqlite-worker-stdout.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeSync: vi.fn(actual.writeSync) };
});

afterEach(() => {
  vi.mocked(writeSync).mockReset();
  vi.useRealTimers();
});

it("preserves exact UTF-8 bytes across partial writes and temporary backpressure", async () => {
  vi.useFakeTimers();
  const result = { ok: false as const, message: "Grüße ⚡" };
  const chunks: Buffer[] = [];
  const outcomes = [26, "EAGAIN", "EWOULDBLOCK", 0, 1];
  vi.mocked(writeSync).mockImplementation((_fd, data, offset, length) => {
    const outcome = outcomes.shift();
    if (typeof outcome === "string") {
      throw Object.assign(new Error(outcome), { code: outcome });
    }
    const bytes =
      typeof data === "string"
        ? Buffer.from(data)
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const start = typeof offset === "number" ? offset : 0;
    const count = Math.min(outcome ?? bytes.length, length ?? bytes.length);
    chunks.push(bytes.subarray(start, start + count));
    return count;
  });
  const sent = writeSqliteWorkerResponse(result);
  await vi.runAllTimersAsync();
  await sent;
  expect(Buffer.concat(chunks)).toEqual(Buffer.from('{"ok":false,"message":"Grüße ⚡"}'));
});

it("propagates a closed reader after partial output without restarting the frame", async () => {
  const failure = Object.assign(new Error("closed reader"), { code: "EPIPE" });
  vi.mocked(writeSync)
    .mockReturnValueOnce(3)
    .mockImplementationOnce(() => {
      throw failure;
    });
  await expect(writeSqliteWorkerResponse({ ok: false, message: "original" })).rejects.toBe(failure);
});
