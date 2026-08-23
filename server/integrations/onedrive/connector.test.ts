import { describe, expect, it } from "vitest";
import { NotConfiguredOneDriveConnector } from "./connector";

describe("موصل OneDrive الآمن", () => {
  it("يصرح بعدم التهيئة ولا يدعي نجاح اتصال غير موجود", async () => {
    const connector = new NotConfiguredOneDriveConnector();
    const status = await connector.testConnection();
    expect(status).toMatchObject({ configured: false, state: "not_configured" });
  });

  it("يرفض قراءة مجلد قبل نجاح المصادقة الحقيقية", async () => {
    const connector = new NotConfiguredOneDriveConnector();
    await expect(connector.readProductFolder("HJB-001")).rejects.toThrow("غير مهيأ");
  });
});
