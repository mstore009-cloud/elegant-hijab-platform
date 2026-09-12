import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sourceFingerprint } from "./catalogAutomation";

describe("مراجعة تحديثات OneDrive لكتالوج Meta", () => {
  it("يحفظ بصمة المصدر ويكشف الوسائط والبيانات المضافة أو المحذوفة قبل تصدير Meta", () => {
    const source = readFileSync(resolve(process.cwd(), "server/products/catalogAutomation.ts"), "utf8");
    expect(source).toContain("sourceFingerprint(contents, metadata)");
    expect(source).toContain("media_added");
    expect(source).toContain("media_removed");
    expect(source).toContain("media_changed");
    expect(source).toContain("onedrive_update_pending_meta_review");
    expect(source).toContain("upsertMetaCatalogSourceUpdate");
    expect(source).toContain("clearMetaCatalogMediaCopies");
    expect(source).toContain("onedrive_manual_edit_conflict");
    expect(source).toContain("manual_value_preserved");
    expect(source).toContain("protectedFields");
  });

  it("تتغير بصمة المصدر عند تعديل نسخة ملف OneDrive حتى لو بقي الاسم والحجم ثابتين", () => {
    const metadata = { name: "حجاب", description: "وصف", sellingPrice: "15000", previousPrice: null, material: "قطن", sizes: [], problems: [] };
    const first = sourceFingerprint([{ id: "img-1", name: "front.jpg", kind: "file", webUrl: null, size: 123, sourceVersion: "etag-a" }], metadata);
    const sameDifferentOrder = sourceFingerprint([{ id: "img-1", name: "front.jpg", kind: "file", webUrl: null, size: 123, sourceVersion: "etag-a" }], metadata);
    const changed = sourceFingerprint([{ id: "img-1", name: "front.jpg", kind: "file", webUrl: null, size: 123, sourceVersion: "etag-b" }], metadata);
    expect(sameDifferentOrder).toBe(first);
    expect(changed).not.toBe(first);
  });
});
