import { describe, expect, it, vi } from "vitest";
import type { CompleteUploadResponse } from "@/lib/api/contracts";
import { UploadError, type UploadFileOptions } from "@/lib/uploads/client";
import { UploadQueue, type UploadQueueEntry } from "@/lib/uploads/queue";

interface PendingUpload {
  options: UploadFileOptions;
  resolve: (value: CompleteUploadResponse) => void;
  reject: (error: unknown) => void;
}

/** Fake runner that lets each test drive every upload by hand; honours the abort signal like uploadFile. */
function controllableRunner() {
  const pending: PendingUpload[] = [];
  const runner = vi.fn(
    (options: UploadFileOptions) =>
      new Promise<CompleteUploadResponse>((resolve, reject) => {
        pending.push({ options, resolve, reject });
        options.signal?.addEventListener("abort", () => reject(new UploadError("aborted", "Upload cancelled.")));
      }),
  );
  return { runner, pending };
}

function mp3(name: string, size = 100): UploadQueueEntry {
  return { file: new File([new Uint8Array(size)], name, { type: "audio/mpeg" }), target: { kind: "track" } };
}

const result = (id: string): CompleteUploadResponse => ({
  kind: "logo",
  businessId: id,
  logoPath: `${id}/logo.png`,
  logoUrl: "https://example/logo",
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("UploadQueue", () => {
  it("runs at most two uploads at a time and starts the next when one finishes", async () => {
    const { runner, pending } = controllableRunner();
    const queue = new UploadQueue({ upload: runner });
    const ids = queue.add([mp3("a.mp3"), mp3("b.mp3"), mp3("c.mp3")]);

    expect(runner).toHaveBeenCalledTimes(2);
    expect(queue.getSnapshot().map((item) => item.phase)).toEqual(["signing", "signing", "queued"]);

    pending[0].resolve(result("a"));
    await flush();
    expect(runner).toHaveBeenCalledTimes(3);
    const [a, , c] = queue.getSnapshot();
    expect(a).toMatchObject({ id: ids[0], phase: "done", progress: 1, result: result("a") });
    expect(c.phase).toBe("signing");
  });

  it("tracks phases and throttles progress updates", async () => {
    const { runner, pending } = controllableRunner();
    const queue = new UploadQueue({ upload: runner });
    const listener = vi.fn();
    queue.subscribe(listener);
    queue.add([mp3("a.mp3")]);
    const { options } = pending[0];

    options.onPhase?.("uploading");
    listener.mockClear();
    options.onProgress?.(0.005);
    expect(listener).not.toHaveBeenCalled();
    options.onProgress?.(0.5);
    expect(queue.getSnapshot()[0]).toMatchObject({ phase: "uploading", progress: 0.5 });
    options.onPhase?.("validating");
    expect(queue.getSnapshot()[0].phase).toBe("validating");
  });

  it("marks invalid files as errors immediately without uploading", () => {
    const { runner } = controllableRunner();
    const queue = new UploadQueue({ upload: runner });
    queue.add([{ file: new File(["x"], "notes.txt", { type: "text/plain" }), target: { kind: "track" } }]);
    expect(runner).not.toHaveBeenCalled();
    expect(queue.getSnapshot()[0]).toMatchObject({ phase: "error", error: expect.stringContaining("not an MP3") });
  });

  it("cancels queued and in-flight uploads, but not while validating", async () => {
    const { runner, pending } = controllableRunner();
    const queue = new UploadQueue({ upload: runner, concurrency: 1 });
    const [first, second] = queue.add([mp3("a.mp3"), mp3("b.mp3")]);

    expect(queue.cancel(second)).toBe(true);
    expect(queue.getSnapshot()[1].phase).toBe("cancelled");

    pending[0].options.onPhase?.("validating");
    expect(queue.cancel(first)).toBe(false);
    expect(queue.remove(first)).toBe(false);

    pending[0].options.onPhase?.("uploading");
    expect(queue.cancel(first)).toBe(true);
    await flush();
    expect(queue.getSnapshot()[0].phase).toBe("cancelled");
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("records failures with the user-facing message and retries them", async () => {
    const { runner, pending } = controllableRunner();
    const queue = new UploadQueue({ upload: runner });
    const [id] = queue.add([mp3("a.mp3")]);

    pending[0].reject(new UploadError("unsupported_media", "This file is not a valid MP3."));
    await flush();
    expect(queue.getSnapshot()[0]).toMatchObject({ phase: "error", error: "This file is not a valid MP3." });

    expect(queue.retry(id)).toBe(true);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(queue.getSnapshot()[0]).toMatchObject({ phase: "signing", error: null });
    pending[1].resolve(result("a"));
    await flush();
    expect(queue.getSnapshot()[0].phase).toBe("done");
  });

  it("hides unexpected errors behind a generic message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runner, pending } = controllableRunner();
    const queue = new UploadQueue({ upload: runner });
    queue.add([mp3("a.mp3")]);
    pending[0].reject(new TypeError("x is undefined"));
    await flush();
    expect(queue.getSnapshot()[0]).toMatchObject({ phase: "error", error: "Upload failed unexpectedly. Please try again." });
    vi.restoreAllMocks();
  });

  it("removes items (aborting in-flight ones) and ignores their late results", async () => {
    const { runner, pending } = controllableRunner();
    const queue = new UploadQueue({ upload: runner, concurrency: 1 });
    const [first] = queue.add([mp3("a.mp3"), mp3("b.mp3")]);

    expect(queue.remove(first)).toBe(true);
    expect(pending[0].options.signal?.aborted).toBe(true);
    await flush();
    expect(queue.getSnapshot().map((item) => item.name)).toEqual(["b.mp3"]);
    expect(queue.getSnapshot()[0].phase).toBe("signing");
  });

  it("notifies onUploaded and clears finished items", async () => {
    const { runner, pending } = controllableRunner();
    const queue = new UploadQueue({ upload: runner });
    const onUploaded = vi.fn();
    queue.setOnUploaded(onUploaded);
    queue.add([mp3("a.mp3"), mp3("b.mp3")]);

    pending[0].resolve(result("a"));
    pending[1].reject(new UploadError("server_error", "Nope."));
    await flush();
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(onUploaded.mock.calls[0][0]).toMatchObject({ name: "a.mp3", phase: "done" });

    queue.clearFinished();
    expect(queue.getSnapshot().map((item) => item.name)).toEqual(["b.mp3"]);
  });

  it("abortAll cancels every transfer in flight", async () => {
    const { runner } = controllableRunner();
    const queue = new UploadQueue({ upload: runner });
    queue.add([mp3("a.mp3"), mp3("b.mp3")]);
    queue.abortAll();
    await flush();
    expect(queue.getSnapshot().map((item) => item.phase)).toEqual(["cancelled", "cancelled"]);
  });

  // UPL-01: leaving /admin/music mid-batch used to cancel the two files in flight while the aborted
  // transfers' settling started the queued ones with fresh controllers, uploading them without a page.
  it("abortAll stops the whole queue: waiting files are cancelled too and nothing new starts", async () => {
    const { runner, pending } = controllableRunner();
    const queue = new UploadQueue({ upload: runner });
    const listener = vi.fn();
    queue.subscribe(listener);
    queue.add([mp3("a.mp3"), mp3("b.mp3"), mp3("c.mp3"), mp3("d.mp3")]);
    expect(runner).toHaveBeenCalledTimes(2);

    listener.mockClear();
    queue.abortAll();
    // The waiting files are cancelled at once (one update), the transfers when they settle.
    expect(queue.getSnapshot().map((item) => item.phase)).toEqual(["signing", "signing", "cancelled", "cancelled"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(pending.map((upload) => upload.options.signal?.aborted)).toEqual([true, true]);

    await flush();
    await flush();
    expect(queue.getSnapshot().map((item) => item.phase)).toEqual(["cancelled", "cancelled", "cancelled", "cancelled"]);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(queue.isStopped()).toBe(true);
  });

  it("lets a file the server is already checking finish after abortAll, without starting the next one", async () => {
    // Like uploadFile(): once the bytes are stored, the abort signal no longer applies.
    const uploads: (PendingUpload & { validating: boolean })[] = [];
    const runner = vi.fn(
      (options: UploadFileOptions) =>
        new Promise<CompleteUploadResponse>((resolve, reject) => {
          const upload = { options, resolve, reject, validating: false };
          uploads.push(upload);
          options.signal?.addEventListener("abort", () => {
            if (!upload.validating) reject(new UploadError("aborted", "Upload cancelled."));
          });
        }),
    );
    const queue = new UploadQueue({ upload: runner, concurrency: 1 });
    queue.add([mp3("a.mp3"), mp3("b.mp3")]);
    uploads[0].validating = true;
    uploads[0].options.onPhase?.("validating");

    queue.abortAll();
    uploads[0].resolve(result("a"));
    await flush();
    expect(queue.getSnapshot().map((item) => item.phase)).toEqual(["done", "cancelled"]);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("resume() makes a stopped queue usable again (React Strict Mode re-runs the owning effect)", () => {
    const { runner } = controllableRunner();
    const queue = new UploadQueue({ upload: runner });
    // Effect setup, the simulated unmount, setup again — all before any file is added.
    queue.resume();
    queue.abortAll();
    queue.resume();
    expect(queue.isStopped()).toBe(false);

    queue.add([mp3("a.mp3"), mp3("b.mp3"), mp3("c.mp3")]);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(queue.getSnapshot().map((item) => item.phase)).toEqual(["signing", "signing", "queued"]);
  });

  it("keeps files added or retried while stopped waiting until resume()", async () => {
    const { runner } = controllableRunner();
    const queue = new UploadQueue({ upload: runner, concurrency: 1 });
    const [, second] = queue.add([mp3("a.mp3"), mp3("b.mp3")]);
    queue.abortAll();
    await flush();
    expect(queue.getSnapshot().map((item) => item.phase)).toEqual(["cancelled", "cancelled"]);

    expect(queue.retry(second)).toBe(true);
    queue.add([mp3("c.mp3")]);
    expect(queue.getSnapshot().map((item) => item.phase)).toEqual(["cancelled", "queued", "queued"]);
    expect(runner).toHaveBeenCalledTimes(1);

    queue.resume();
    expect(runner).toHaveBeenCalledTimes(2);
    expect(queue.getSnapshot().map((item) => item.phase)).toEqual(["cancelled", "signing", "queued"]);
  });

  it("returns a stable snapshot between changes", () => {
    const queue = new UploadQueue({ upload: controllableRunner().runner });
    expect(queue.getSnapshot()).toBe(queue.getSnapshot());
  });
});
