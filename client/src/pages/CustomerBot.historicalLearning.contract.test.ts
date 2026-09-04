import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CustomerBot historical learning review flow", () => {
  it("offers a real instruction simulation chat and explicitly prevents external sending", () => {
    const source = readFileSync(new URL("./CustomerBot.tsx", import.meta.url), "utf8");
    expect(source).toContain("customerBot.simulateInstruction.useMutation");
    expect(source).toContain("مختبر تعليمات المشغل");
    expect(source).toContain("لا إرسال");
    expect(source).toContain("هذه محاكاة داخلية؛ لم تُنشأ مسودة ولم تُرسل رسالة.");
    expect(source).toContain("AIChatBox");
  });

  it("offers an explicit bot.teach opt-in and keeps learned style as a draft", () => {
    const source = readFileSync(new URL("./CustomerBot.tsx", import.meta.url), "utf8");
    expect(source).toContain("customerBot.teachFromReview.useMutation");
    expect(source).toContain("تحويل هذه الصياغة إلى مرشح تعليم");
    expect(source).toContain("يلزم اعتماده من صلاحية المعرفة");
    expect(source).toContain("لا يقبل تعليم السعر أو المخزون");
  });

  it("offers a real extraction action and explicitly keeps candidates as drafts", () => {
    const source = readFileSync(new URL("./CustomerBot.tsx", import.meta.url), "utf8");
    expect(source).toContain("customerBot.extractHistoricalCandidates.useMutation");
    expect(source).toContain("استخراج من التاريخ");
    expect(source).toContain("ولا يعتمدها Bot-H3 أو يستخدمها تلقائياً");
    expect(source).toContain("article.source === \"historical_candidate\"");
    expect(source).toContain("historicalChannels");
    expect(source).toContain("channels: historicalChannels");
  });
});
