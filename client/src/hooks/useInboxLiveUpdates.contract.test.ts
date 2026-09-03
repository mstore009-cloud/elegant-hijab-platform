import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Inbox live update client", () => {
  it("uses the authenticated stream, reconnects safely, and avoids session tokens in the URL", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/hooks/useInboxLiveUpdates.ts"), "utf8");
    expect(source).toContain('fetch(`/api/inbox/live?after=${encodeURIComponent(String(after))}`');
    expect(source).toContain("getSessionAuthorizationHeader()");
    expect(source).toContain("credentials: \"include\"");
    expect(source).toContain("lastEventId = eventId");
    expect(source).not.toContain("token=");
  });
});
