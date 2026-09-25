import { describe, expect, it } from "vitest";
import {
  collectBusinessStoragePaths,
  listObjectsUnder,
  removeBusinessStorage,
  removeObjects,
  STORAGE_LIST_PAGE_SIZE,
  STORAGE_REMOVE_BATCH_SIZE,
  StorageCleanupError,
  type StorageBucketApi,
  type StorageClientLike,
} from "@/lib/data/admin/businesses";

/**
 * Minimal Supabase Storage fake with the v1 `list()` semantics: one level per call, folders as
 * entries with `id: null`, limit/offset paging over folders and files sorted by name.
 */
class FakeBucket implements StorageBucketApi {
  objects = new Set<string>();
  listCalls: string[] = [];
  removeCalls: string[][] = [];
  failList = false;
  failRemove = false;

  constructor(paths: string[] = []) {
    for (const path of paths) this.objects.add(path);
  }

  async list(path = "", options: { limit?: number; offset?: number } = {}) {
    this.listCalls.push(`${path}@${options.offset ?? 0}`);
    if (this.failList) return { data: null, error: { message: "list failed" } };
    const prefix = path ? `${path}/` : "";
    const entries = new Map<string, { name: string; id: string | null }>();
    for (const object of this.objects) {
      if (!object.startsWith(prefix)) continue;
      const rest = object.slice(prefix.length);
      const [first, ...more] = rest.split("/");
      entries.set(first, { name: first, id: more.length > 0 ? null : `id-${object}` });
    }
    const sorted = [...entries.values()].sort((a, b) => a.name.localeCompare(b.name));
    const offset = options.offset ?? 0;
    return { data: sorted.slice(offset, offset + (options.limit ?? 100)), error: null };
  }

  async remove(paths: string[]) {
    this.removeCalls.push(paths);
    if (this.failRemove) return { data: null, error: { message: "remove failed" } };
    for (const path of paths) this.objects.delete(path);
    return { data: paths.map((name) => ({ name })), error: null };
  }
}

function storageOf(buckets: Record<string, FakeBucket>): StorageClientLike {
  return {
    storage: {
      from(bucket: string) {
        const found = buckets[bucket];
        if (!found) throw new Error(`unexpected bucket ${bucket}`);
        return found;
      },
    },
  };
}

const BIZ = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("listObjectsUnder", () => {
  it("lists files and follows folders to the given depth", async () => {
    const bucket = new FakeBucket([`${BIZ}/a1/x.mp3`, `${BIZ}/a1/y.mp3`, `${BIZ}/a2/z.mp3`, `${BIZ}/stray.mp3`, `${OTHER}/a3/w.mp3`]);
    expect((await listObjectsUnder(bucket, BIZ, 1)).sort()).toEqual(
      [`${BIZ}/a1/x.mp3`, `${BIZ}/a1/y.mp3`, `${BIZ}/a2/z.mp3`, `${BIZ}/stray.mp3`].sort(),
    );
    // Depth 0 ignores folders.
    expect(await listObjectsUnder(bucket, BIZ, 0)).toEqual([`${BIZ}/stray.mp3`]);
  });

  it("pages through large folders", async () => {
    const paths = Array.from({ length: STORAGE_LIST_PAGE_SIZE + 5 }, (_, index) => `${BIZ}/${String(index).padStart(5, "0")}.png`);
    const bucket = new FakeBucket(paths);
    const listed = await listObjectsUnder(bucket, BIZ, 0);
    expect(listed).toHaveLength(paths.length);
    expect(bucket.listCalls).toEqual([`${BIZ}@0`, `${BIZ}@${STORAGE_LIST_PAGE_SIZE}`]);
  });

  it("throws a StorageCleanupError when listing fails", async () => {
    const bucket = new FakeBucket([`${BIZ}/logo.png`]);
    bucket.failList = true;
    await expect(listObjectsUnder(bucket, BIZ, 0)).rejects.toBeInstanceOf(StorageCleanupError);
  });
});

describe("removeObjects", () => {
  it("removes unique paths in batches", async () => {
    const paths = Array.from({ length: STORAGE_REMOVE_BATCH_SIZE + 1 }, (_, index) => `${BIZ}/${index}.png`);
    const bucket = new FakeBucket(paths);
    expect(await removeObjects(bucket, [...paths, paths[0]])).toBe(paths.length);
    expect(bucket.removeCalls.map((batch) => batch.length)).toEqual([STORAGE_REMOVE_BATCH_SIZE, 1]);
    expect(bucket.objects.size).toBe(0);
  });

  it("does nothing for an empty list and throws on a failed batch", async () => {
    const bucket = new FakeBucket();
    expect(await removeObjects(bucket, [])).toBe(0);
    expect(bucket.removeCalls).toEqual([]);
    bucket.failRemove = true;
    await expect(removeObjects(bucket, [`${BIZ}/x.png`])).rejects.toBeInstanceOf(StorageCleanupError);
  });
});

describe("business storage cleanup", () => {
  it("collects listed and known paths but never outside the business prefix", async () => {
    const logos = new FakeBucket([`${BIZ}/logo-new.png`, `${OTHER}/logo.png`]);
    const announcements = new FakeBucket([`${BIZ}/ann1/a.mp3`, `${BIZ}/ann2/b.mp3`, `${OTHER}/ann3/c.mp3`]);
    const storage = storageOf({ logos, announcements });

    const paths = await collectBusinessStoragePaths(storage, BIZ, {
      logos: [`${BIZ}/logo-old.png`, `${OTHER}/logo.png`],
      announcements: [`${BIZ}/ann1/a.mp3`, `${BIZ}/ann4/d.mp3`, `${OTHER}/ann3/c.mp3`, `${BIZ}/../${OTHER}/ann3/c.mp3`],
    });
    expect(paths.logos.sort()).toEqual([`${BIZ}/logo-new.png`, `${BIZ}/logo-old.png`].sort());
    expect(paths.announcements.sort()).toEqual([`${BIZ}/ann1/a.mp3`, `${BIZ}/ann2/b.mp3`, `${BIZ}/ann4/d.mp3`].sort());

    expect(await removeBusinessStorage(storage, paths)).toBe(5);
    expect([...logos.objects]).toEqual([`${OTHER}/logo.png`]);
    expect([...announcements.objects]).toEqual([`${OTHER}/ann3/c.mp3`]);
  });
});
