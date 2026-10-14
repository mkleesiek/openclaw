import fs, { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeFileSync: vi.fn(actual.writeFileSync) };
});

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.mocked(writeFileSync).mockReset();
  vi.resetModules();
});

it.each([
  { mode: "content-version", missing: false },
  { mode: "file-generation", missing: false },
  { mode: "content-version", missing: true },
  { mode: "file-generation", missing: true },
])("delivers $mode JSON with unknown stdout (missing: $missing)", async ({ mode, missing }) => {
  const source = path.join(tempDirs.make("sqlite-revision-stdout-"), "source.sqlite");
  if (!missing) {
    fs.writeFileSync(source, "");
  }
  process.argv = [process.execPath, "worker", "--openclaw-sqlite-readonly-child", mode, source];
  process.exitCode = 0;
  // Reproduce Node's UNKNOWN handle: writes are acknowledged but no bytes are delivered.
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  let output = "";
  vi.mocked(writeFileSync).mockImplementation((file, data, options) => {
    if (file !== 1) {
      fs.writeFileSync(file, data, options);
      return;
    }
    output +=
      typeof data === "string"
        ? data
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString();
  });

  await import("./sqlite-source-revision.worker.js");

  expect(output).not.toBe("");
  const result = JSON.parse(output);
  if (missing) {
    expect(result).toEqual({ ok: false, message: expect.stringContaining("ENOENT") });
    expect(result.message).toContain(source);
    expect(process.exitCode).toBe(1);
  } else if (mode === "content-version") {
    expect(result).toEqual({ ok: true, contentVersion: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(process.exitCode).toBe(0);
  } else {
    expect(result).toEqual({ ok: true, generation: expect.any(String) });
    expect(JSON.parse(result.generation)).toMatchObject({ database: { size: "0" } });
    expect(process.exitCode).toBe(0);
  }
});
