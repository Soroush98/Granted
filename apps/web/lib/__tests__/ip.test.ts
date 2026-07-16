// RQ10 — client-IP resolution for rate limiting (cases IP-*).
// Technique: decision table over header presence/precedence.
import { beforeEach, describe, expect, it, vi } from "vitest";

const headerStore: Record<string, string> = {};

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => headerStore[name.toLowerCase()] ?? null,
  }),
}));

import { getClientIp, UNKNOWN_IP } from "@/lib/ip";

beforeEach(() => {
  for (const k of Object.keys(headerStore)) delete headerStore[k];
});

describe("getClientIp header precedence", () => {
  it("IP-01 cf-connecting-ip wins over everything", async () => {
    headerStore["cf-connecting-ip"] = "1.1.1.1";
    headerStore["x-vercel-forwarded-for"] = "2.2.2.2";
    headerStore["x-forwarded-for"] = "3.3.3.3, 4.4.4.4";
    headerStore["x-real-ip"] = "5.5.5.5";
    expect(await getClientIp()).toBe("1.1.1.1");
  });

  it("IP-02 x-vercel-forwarded-for is second", async () => {
    headerStore["x-vercel-forwarded-for"] = "2.2.2.2";
    headerStore["x-forwarded-for"] = "3.3.3.3";
    expect(await getClientIp()).toBe("2.2.2.2");
  });

  it("IP-03 x-forwarded-for uses only the first (client) hop", async () => {
    headerStore["x-forwarded-for"] = " 3.3.3.3 , 10.0.0.1, 10.0.0.2";
    expect(await getClientIp()).toBe("3.3.3.3");
  });

  it("IP-04 x-real-ip is the last fallback", async () => {
    headerStore["x-real-ip"] = "5.5.5.5";
    expect(await getClientIp()).toBe("5.5.5.5");
  });

  it("IP-05 no headers → null; UNKNOWN_IP marker is a distinct constant", async () => {
    expect(await getClientIp()).toBeNull();
    // An XFF that reduces to nothing must not resolve to a fake address.
    headerStore["x-forwarded-for"] = " , 10.0.0.1";
    expect(await getClientIp()).toBeNull();
    expect(UNKNOWN_IP).toBe("_unknown");
  });
});
