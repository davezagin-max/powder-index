import { describe, expect, it, vi } from "vitest";
import bundled from "@/public/data/dashboard.json";
import { loadPublished } from "@/lib/data/load";

const BASE = "https://example.test/data";
const signal = () => new AbortController().signal;
const newer = { ...bundled, generatedAt: "2099-01-01T00:00:00Z" };

function fetcher(routes: Record<string, unknown | number>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const body = routes[String(input)];
    if (body === undefined) throw new TypeError("network down");
    if (typeof body === "number") return new Response("nope", { status: body });
    return Response.json(body);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("loadPublished", () => {
  it("switches to published data when it is newer", async () => {
    const fetch = fetcher({
      [`${BASE}/manifest.json`]: { generatedAt: newer.generatedAt, asOf: newer.asOf },
      [`${BASE}/dashboard.json`]: newer,
    });
    const data = await loadPublished(bundled.generatedAt, signal(), fetch, BASE);
    expect(data?.generatedAt).toBe("2099-01-01T00:00:00Z");
    expect(data?.resorts).toHaveLength(12);
  });

  it("keeps the bundled data when the published copy is older, without downloading it", async () => {
    const fetch = fetcher({ [`${BASE}/manifest.json`]: { generatedAt: "2020-01-01T00:00:00Z", asOf: "2020-01-01" } });
    expect(await loadPublished(bundled.generatedAt, signal(), fetch, BASE)).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the bundled data when Pages is down, missing, or serving the wrong shape", async () => {
    expect(await loadPublished(bundled.generatedAt, signal(), fetcher({}), BASE)).toBeNull();
    expect(await loadPublished(bundled.generatedAt, signal(), fetcher({ [`${BASE}/manifest.json`]: 404 }), BASE)).toBeNull();
    const wrongShape = fetcher({
      [`${BASE}/manifest.json`]: { generatedAt: newer.generatedAt, asOf: newer.asOf },
      [`${BASE}/dashboard.json`]: { generatedAt: newer.generatedAt, resorts: "soon" },
    });
    expect(await loadPublished(bundled.generatedAt, signal(), wrongShape, BASE)).toBeNull();
    const truncated = structuredClone(newer);
    truncated.resorts[3].series.depth.length = 10;
    const short = fetcher({
      [`${BASE}/manifest.json`]: { generatedAt: newer.generatedAt, asOf: newer.asOf },
      [`${BASE}/dashboard.json`]: truncated,
    });
    expect(await loadPublished(bundled.generatedAt, signal(), short, BASE)).toBeNull();
  });

  it("keeps the bundled data in a browser too old to combine abort signals", async () => {
    const fetch = fetcher({
      [`${BASE}/manifest.json`]: { generatedAt: newer.generatedAt, asOf: newer.asOf },
      [`${BASE}/dashboard.json`]: newer,
    });
    const any = vi.spyOn(AbortSignal, "any").mockImplementation(() => {
      throw new TypeError("AbortSignal.any is not a function");
    });
    try {
      // It must resolve to null, not reject: nothing awaits this promise with a catch.
      await expect(loadPublished(bundled.generatedAt, signal(), fetch, BASE)).resolves.toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      any.mockRestore();
    }
  });

  it("does nothing when published data is switched off", async () => {
    const fetch = fetcher({});
    expect(await loadPublished(bundled.generatedAt, signal(), fetch, "off")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
