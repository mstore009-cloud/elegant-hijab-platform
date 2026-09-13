import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  customerBotBehaviorCards,
  customerBotKnowledgeArticles,
  customerBotLearningProposals,
  customerBotPlaybooks,
  customerBotTestCases,
  stores,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { getPlaygroundFacts, setLearningProposalStatus } from "./playground";

const cleanups: Array<{ storeId: number; proposalIds: number[] }> = [];

afterEach(async () => {
  const db = await getDb();
  if (!db) return;
  for (const cleanup of cleanups.splice(0)) {
    await db.delete(customerBotBehaviorCards).where(eq(customerBotBehaviorCards.storeId, cleanup.storeId));
    await db.delete(customerBotPlaybooks).where(eq(customerBotPlaybooks.storeId, cleanup.storeId));
    await db.delete(customerBotTestCases).where(eq(customerBotTestCases.storeId, cleanup.storeId));
    await db.delete(customerBotKnowledgeArticles).where(eq(customerBotKnowledgeArticles.storeId, cleanup.storeId));
    await db.delete(customerBotLearningProposals).where(eq(customerBotLearningProposals.storeId, cleanup.storeId));
    await db.delete(stores).where(eq(stores.id, cleanup.storeId));
  }
});

describe("تفعيل تعلم Customer Bot", () => {
  it("يجعل الأثر الناتج من الاقتراح المعتمد فعالاً فوراً بدل إبقائه مسودة", async () => {
    const db = await getDb();
    const [owner] = db ? await db.select({ id: users.id }).from(users).limit(1) : [];
    if (!db || !owner) throw new Error("لا توجد قاعدة بيانات أو مستخدم لاختبار التعلم.");

    const storeResult = await db.insert(stores).values({ name: "متجر تفعيل التعلم", slug: `learning-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const storeId = Number(storeResult[0].insertId);
    const proposalIds: number[] = [];
    cleanups.push({ storeId, proposalIds });

    for (const category of ["dialect_style", "sales_playbook", "knowledge", "test_case"] as const) {
      const proposalResult = await db.insert(customerBotLearningProposals).values({
        storeId,
        category,
        originalReply: "سؤال العميل",
        editedReply: "هلا بيج، أساعدج بكل سرور.",
        title: `اختبار ${category}`,
        body: category === "sales_playbook" ? "عند سؤال السعر اقرئي السعر الحالي ثم اعرضي الألوان." : "استخدمي لهجة عراقية بسيطة ومهذبة.",
        status: "draft",
        createdByUserId: owner.id,
      });
      const proposalId = Number(proposalResult[0].insertId);
      proposalIds.push(proposalId);
      const result = await setLearningProposalStatus({ storeId, actorUserId: owner.id, proposalId, status: "approved" });
      expect(result.proposal.status).toBe("approved");
      expect(result.artifact).not.toBeNull();
    }

    const [behavior] = await db.select({ status: customerBotBehaviorCards.status }).from(customerBotBehaviorCards).where(eq(customerBotBehaviorCards.storeId, storeId)).limit(1);
    const [playbook] = await db.select({ status: customerBotPlaybooks.status }).from(customerBotPlaybooks).where(eq(customerBotPlaybooks.storeId, storeId)).limit(1);
    const [knowledge] = await db.select({ status: customerBotKnowledgeArticles.status }).from(customerBotKnowledgeArticles).where(eq(customerBotKnowledgeArticles.storeId, storeId)).limit(1);
    const [testCase] = await db.select({ status: customerBotTestCases.status }).from(customerBotTestCases).where(eq(customerBotTestCases.storeId, storeId)).limit(1);

    expect(behavior?.status).toBe("approved");
    expect(playbook?.status).toBe("approved");
    expect(knowledge?.status).toBe("approved");
    expect(testCase?.status).toBe("approved");

    const facts = await getPlaygroundFacts(db, storeId, "knowledge");
    expect(facts.behaviorCards.some((card: any) => card.title.includes("dialect_style"))).toBe(true);
    expect(facts.playbooks.some((playbook: any) => playbook.title.includes("sales_playbook"))).toBe(true);
    expect(facts.knowledge.some((article: any) => article.title.includes("knowledge"))).toBe(true);
  });
});
