import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

describe("Customer Bot training center", () => {
  it("splits the crowded center into dedicated operational pages", () => {
    const source = read("CustomerBot.tsx");
    expect(source).toContain("مختبر المحادثة");
    expect(source).toContain("مساعد التعليم");
    expect(source).toContain("المعرفة والتعلم");
    expect(source).toContain("الاختبارات والمسودات");
  });

  it("offers a real playground that explicitly blocks external sending and final orders", () => {
    const source = read("CustomerBotPlayground.tsx");
    expect(source).toContain("customerBot.createPlaygroundSession.useMutation");
    expect(source).toContain("customerBot.sendPlaygroundMessage.useMutation");
    expect(source).toContain("لا إرسال إلى Meta");
    expect(source).toContain("لا إنشاء طلب نهائي");
    expect(source).toContain("تعديل وتعليم");
    expect(source).toContain("customerBot.createLearningProposal.useMutation");
  });

  it("offers text and voice command interpretation before saving a draft", () => {
    const source = read("CustomerBotCommandAssistant.tsx");
    expect(source).toContain("customerBot.createTextCommand.useMutation");
    expect(source).toContain("customerBot.createAudioCommand.useMutation");
    expect(source).toContain("editedTranscript");
    expect(source).toContain("عدّليه قبل الحفظ");
    expect(source).toContain("حفظ كبطاقة معرفة");
    expect(source).toContain('category: "knowledge"');
    expect(source).toContain("فهم المساعد");
    expect(source).toContain("حفظ كمسودة تعليمية");
    expect(source).toContain("لا يُشغّل المساعد القنوات");
  });

  it("keeps command guidance inside the learning center with practical templates", () => {
    const learning = read("CustomerBotLearning.tsx");
    const nav = read("../components/customerBot/CustomerBotNav.tsx");
    const library = read("../components/customerBot/TrainingCommandLibrary.tsx");
    expect(learning).toContain("مساعد التعليم");
    expect(learning).toContain("بطاقة معرفة جديدة");
    expect(learning).toContain("assistant");
    expect(nav).not.toContain('path: "/customer-bot/commands"');
    expect(library).toContain("طريقة الكلام");
    expect(library).toContain("خطوات البيع");
    expect(library).toContain("معلومة ناقصة");
  });

  it("keeps live facts separate from RAG knowledge in the learning page", () => {
    const source = read("CustomerBotLearning.tsx");
    expect(source).toContain("السعر والمخزون وحالة الطلب");
    expect(source).toContain("بيانات المنصة الحية");
    expect(source).toContain("لا يتعلم البوت مباشرة من الملف");
  });
});
