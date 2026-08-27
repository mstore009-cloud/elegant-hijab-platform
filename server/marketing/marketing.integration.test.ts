import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentPostActivities,
  contentPosts,
  customerTags,
  marketingCampaignActivities,
  marketingCampaignBudgetItems,
  marketingCampaignContent,
  marketingCampaigns,
  products,
  stores,
  users,
} from "../../drizzle/schema";
import { createContentPostDraft, requestContentPostReview, reviewContentPost } from "../content/db";
import { getDb } from "../db";
import {
  createMarketingCampaign,
  getMarketingCampaign,
  listMarketingCampaigns,
  removeMarketingBudgetItem,
  replaceCampaignContent,
  requestCampaignApproval,
  reviewMarketingCampaign,
  saveMarketingBudgetItem,
  updateMarketingCampaign,
} from "./db";

describe("Marketing-A: الحملة الداخلية والمراجعة", () => {
  const cleanup: Array<{ storeId: number; campaignIds: number[]; postIds: number[]; tagIds: number[]; productIds: number[] }> = [];

  afterEach(async () => {
    const db = await getDb();
    if (!db) return;
    for (const entry of cleanup.splice(0)) {
      for (const campaignId of entry.campaignIds) {
        await db.delete(marketingCampaignActivities).where(eq(marketingCampaignActivities.campaignId, campaignId));
        await db.delete(marketingCampaignBudgetItems).where(eq(marketingCampaignBudgetItems.campaignId, campaignId));
        await db.delete(marketingCampaignContent).where(eq(marketingCampaignContent.campaignId, campaignId));
        await db.delete(marketingCampaigns).where(eq(marketingCampaigns.id, campaignId));
      }
      for (const postId of entry.postIds) {
        await db.delete(contentPostActivities).where(eq(contentPostActivities.postId, postId));
        await db.delete(contentPosts).where(eq(contentPosts.id, postId));
      }
      for (const tagId of entry.tagIds) await db.delete(customerTags).where(eq(customerTags.id, tagId));
      for (const productId of entry.productIds) await db.delete(products).where(eq(products.id, productId));
      await db.delete(stores).where(eq(stores.id, entry.storeId));
    }
  });

  it("يعزل الحملة وجمهورها ومحتواها وميزانيتها حسب المتجر ويعيد الاعتماد إلى مسودة عند التعديل", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار Marketing-A.");
    const [owner] = await db.select().from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار Marketing-A.");

    const firstStore = await db.insert(stores).values({ name: "متجر اختبار تسويق 1", slug: `marketing-one-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const secondStore = await db.insert(stores).values({ name: "متجر اختبار تسويق 2", slug: `marketing-two-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const firstStoreId = Number(firstStore[0].insertId);
    const secondStoreId = Number(secondStore[0].insertId);
    cleanup.push({ storeId: firstStoreId, campaignIds: [], postIds: [], tagIds: [], productIds: [] }, { storeId: secondStoreId, campaignIds: [], postIds: [], tagIds: [], productIds: [] });

    const firstTag = await db.insert(customerTags).values({ storeId: firstStoreId, name: "عميلات متكررات", createdByUserId: owner.id });
    const secondTag = await db.insert(customerTags).values({ storeId: secondStoreId, name: "وسم متجر ثان", createdByUserId: owner.id });
    const firstTagId = Number(firstTag[0].insertId);
    const secondTagId = Number(secondTag[0].insertId);
    cleanup[0].tagIds.push(firstTagId);
    cleanup[1].tagIds.push(secondTagId);

    await expect(createMarketingCampaign({ storeId: firstStoreId, createdByUserId: owner.id, name: "حملة غير مسموحة", objective: "promotion", audienceType: "customer_tag", audienceTagId: secondTagId })).rejects.toThrow("لا ينتمي إلى المتجر التشغيلي");

    const campaignId = await createMarketingCampaign({
      storeId: firstStoreId,
      createdByUserId: owner.id,
      name: "إطلالة خريفية",
      objective: "product_launch",
      audienceType: "customer_tag",
      audienceTagId: firstTagId,
      budgetAmount: 25000,
      budgetCurrency: "iqd",
    });
    cleanup[0].campaignIds.push(campaignId);
    await expect(getMarketingCampaign(campaignId, secondStoreId)).rejects.toThrow("الحملة غير موجودة ضمن المتجر الحالي");
    expect(await listMarketingCampaigns({ storeId: secondStoreId })).toEqual([]);

    await expect(requestCampaignApproval({ storeId: firstStoreId, campaignId, actorUserId: owner.id })).rejects.toThrow("مسودة محتوى واحدة معتمدة");

    const firstProduct = await db.insert(products).values({ storeId: firstStoreId, productCode: `MKT-ONE-${randomUUID().slice(0, 8)}`, name: "منتج تسويق أول", status: "draft", sellingPrice: "1.00", createdByUserId: owner.id });
    const secondProduct = await db.insert(products).values({ storeId: secondStoreId, productCode: `MKT-TWO-${randomUUID().slice(0, 8)}`, name: "منتج تسويق ثان", status: "draft", sellingPrice: "1.00", createdByUserId: owner.id });
    const firstProductId = Number(firstProduct[0].insertId);
    const secondProductId = Number(secondProduct[0].insertId);
    cleanup[0].productIds.push(firstProductId);
    cleanup[1].productIds.push(secondProductId);

    const approvedPostId = await createContentPostDraft({ storeId: firstStoreId, productId: firstProductId, title: "منشور معتمد", caption: "محتوى الحملة", createdByUserId: owner.id });
    const otherPostId = await createContentPostDraft({ storeId: secondStoreId, productId: secondProductId, title: "منشور متجر آخر", caption: "لا يربط", createdByUserId: owner.id });
    cleanup[0].postIds.push(approvedPostId);
    cleanup[1].postIds.push(otherPostId);
    await requestContentPostReview({ storeId: firstStoreId, postId: approvedPostId, actorUserId: owner.id });
    await reviewContentPost({ storeId: firstStoreId, postId: approvedPostId, actorUserId: owner.id, decision: "approved" });

    await expect(replaceCampaignContent({ storeId: firstStoreId, campaignId, actorUserId: owner.id, contentPostIds: [otherPostId] })).rejects.toThrow("المتجر الحالي");
    await replaceCampaignContent({ storeId: firstStoreId, campaignId, actorUserId: owner.id, contentPostIds: [approvedPostId] });
    await requestCampaignApproval({ storeId: firstStoreId, campaignId, actorUserId: owner.id, note: "جاهزة للمراجعة" });
    await reviewMarketingCampaign({ storeId: firstStoreId, campaignId, actorUserId: owner.id, decision: "approved", note: "معتمدة للتخطيط فقط" });

    const budgetDetail = await saveMarketingBudgetItem({ storeId: firstStoreId, campaignId, actorUserId: owner.id, name: "تصميم", unitPrice: 5000, quantity: 2 });
    expect(budgetDetail?.campaign).toMatchObject({ status: "draft", budgetAmount: "25000.00", budgetCurrency: "IQD" });
    expect(budgetDetail?.budgetItems[0]).toMatchObject({ name: "تصميم", unitPrice: "5000.00", quantity: 2 });
    const budgetItemId = budgetDetail?.budgetItems[0]?.id;
    if (!budgetItemId) throw new Error("لم ينشأ بند الميزانية للاختبار.");

    await updateMarketingCampaign({ storeId: firstStoreId, campaignId, actorUserId: owner.id, name: "إطلالة خريفية معدلة", audienceType: "relationship_stage", audienceStage: "repeat" });
    const reset = await getMarketingCampaign(campaignId, firstStoreId);
    expect(reset?.campaign).toMatchObject({ name: "إطلالة خريفية معدلة", status: "draft", audienceType: "relationship_stage", audienceTagId: null, audienceStage: "repeat", approvedByUserId: null });
    expect(reset?.content).toHaveLength(1);
    expect(reset?.activities.map(activity => activity.action)).toEqual(expect.arrayContaining(["created", "content_linked", "approval_requested", "approved", "budget_updated", "updated"]));

    await removeMarketingBudgetItem({ storeId: firstStoreId, campaignId, budgetItemId, actorUserId: owner.id });
    const afterDelete = await getMarketingCampaign(campaignId, firstStoreId);
    expect(afterDelete?.budgetItems).toEqual([]);
  }, 20_000);
});
