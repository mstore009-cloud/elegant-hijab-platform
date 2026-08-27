import { and, count, desc, eq, inArray } from "drizzle-orm";
import {
  contentPosts,
  customerProfiles,
  customerTagAssignments,
  customerTags,
  marketingCampaignActivities,
  marketingCampaignBudgetItems,
  marketingCampaignContent,
  marketingCampaigns,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { notifyPermissionHolders } from "../notifications/db";

export type CampaignStatus = "draft" | "needs_approval" | "approved" | "changes_requested" | "archived";
export type CampaignObjective = "product_launch" | "reengagement" | "promotion" | "awareness" | "other";
export type AudienceType = "all_customers" | "customer_tag" | "relationship_stage";
export type RelationshipStage = "new" | "active" | "repeat" | "needs_followup" | "inactive";
type CampaignAction = "created" | "updated" | "content_linked" | "content_unlinked" | "budget_updated" | "approval_requested" | "approved" | "changes_requested" | "archived";

type CampaignFields = {
  name?: string;
  objective?: CampaignObjective;
  description?: string | null;
  audienceType?: AudienceType;
  audienceTagId?: number | null;
  audienceStage?: RelationshipStage | null;
  budgetAmount?: number;
  budgetCurrency?: string;
};

function cleanText(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  return value.trim() || null;
}

function currency(value: string | undefined) {
  const normalized = value?.trim().toUpperCase() || "IQD";
  if (!/^[A-Z]{3,12}$/.test(normalized)) throw new Error("رمز عملة الميزانية غير صالح.");
  return normalized;
}

function money(value: number | undefined, fallback?: string) {
  if (value === undefined) return fallback ?? "0.00";
  if (!Number.isFinite(value) || value < 0 || value > 999_999_999) throw new Error("قيمة الميزانية يجب أن تكون رقماً موجباً ضمن الحد المسموح.");
  return value.toFixed(2);
}

async function assertTag(storeId: number, tagId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [tag] = await db.select({ id: customerTags.id }).from(customerTags).where(and(eq(customerTags.id, tagId), eq(customerTags.storeId, storeId))).limit(1);
  if (!tag) throw new Error("وسم الجمهور لا ينتمي إلى المتجر التشغيلي الحالي.");
}

async function normalizeAudience(storeId: number, fields: Required<Pick<CampaignFields, "audienceType">> & Pick<CampaignFields, "audienceTagId" | "audienceStage">) {
  if (fields.audienceType === "all_customers") return { audienceType: "all_customers" as const, audienceTagId: null, audienceStage: null };
  if (fields.audienceType === "customer_tag") {
    if (!fields.audienceTagId) throw new Error("اختاري وسم جمهور للحملة.");
    await assertTag(storeId, fields.audienceTagId);
    return { audienceType: "customer_tag" as const, audienceTagId: fields.audienceTagId, audienceStage: null };
  }
  if (!fields.audienceStage) throw new Error("اختاري مرحلة العميل لجمهور الحملة.");
  return { audienceType: "relationship_stage" as const, audienceTagId: null, audienceStage: fields.audienceStage };
}

async function getCampaignRow(campaignId: number, storeId: number) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const [campaign] = await db.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.storeId, storeId))).limit(1);
  if (!campaign) throw new Error("الحملة غير موجودة ضمن المتجر الحالي.");
  return campaign;
}

async function recordCampaignActivity(input: { storeId: number; campaignId: number; actorUserId?: number | null; action: CampaignAction; note?: string | null; metadata?: Record<string, unknown> | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.insert(marketingCampaignActivities).values({
    storeId: input.storeId,
    campaignId: input.campaignId,
    actorUserId: input.actorUserId ?? null,
    action: input.action,
    note: cleanText(input.note),
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
  });
}

async function resetApprovalIfNeeded(storeId: number, campaignId: number, currentStatus: CampaignStatus) {
  if (currentStatus !== "needs_approval" && currentStatus !== "approved") return false;
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await db.update(marketingCampaigns).set({ status: "draft", approvedByUserId: null, approvedAt: null, approvalNote: null }).where(and(eq(marketingCampaigns.id, campaignId), eq(marketingCampaigns.storeId, storeId)));
  return true;
}

export async function getCampaignAudienceCount(storeId: number, campaign: { audienceType: AudienceType; audienceTagId: number | null; audienceStage: RelationshipStage | null }) {
  const db = await getDb();
  if (!db) return 0;
  if (campaign.audienceType === "customer_tag" && campaign.audienceTagId) {
    const [result] = await db
      .select({ value: count() })
      .from(customerTagAssignments)
      .innerJoin(customerProfiles, eq(customerTagAssignments.customerId, customerProfiles.id))
      .where(and(eq(customerTagAssignments.tagId, campaign.audienceTagId), eq(customerProfiles.storeId, storeId)));
    return Number(result?.value ?? 0);
  }
  const [result] = await db
    .select({ value: count() })
    .from(customerProfiles)
    .where(and(eq(customerProfiles.storeId, storeId), campaign.audienceType === "relationship_stage" && campaign.audienceStage ? eq(customerProfiles.relationshipStage, campaign.audienceStage) : undefined));
  return Number(result?.value ?? 0);
}

async function getCampaignDetail(campaignId: number, storeId: number) {
  const db = await getDb();
  if (!db) return null;
  const campaign = await getCampaignRow(campaignId, storeId);
  const [content, budgetItems, activities, audienceCount] = await Promise.all([
    db.select({ link: marketingCampaignContent, post: contentPosts }).from(marketingCampaignContent).innerJoin(contentPosts, eq(marketingCampaignContent.contentPostId, contentPosts.id)).where(eq(marketingCampaignContent.campaignId, campaignId)),
    db.select().from(marketingCampaignBudgetItems).where(eq(marketingCampaignBudgetItems.campaignId, campaignId)).orderBy(marketingCampaignBudgetItems.id),
    db.select().from(marketingCampaignActivities).where(and(eq(marketingCampaignActivities.campaignId, campaignId), eq(marketingCampaignActivities.storeId, storeId))).orderBy(desc(marketingCampaignActivities.createdAt), desc(marketingCampaignActivities.id)),
    getCampaignAudienceCount(storeId, campaign),
  ]);
  return { campaign, content, budgetItems, activities, audienceCount };
}

export async function listMarketingCampaigns(input: { storeId: number; status?: CampaignStatus }) {
  const db = await getDb();
  if (!db) return [];
  const campaigns = await db.select().from(marketingCampaigns).where(and(eq(marketingCampaigns.storeId, input.storeId), input.status ? eq(marketingCampaigns.status, input.status) : undefined)).orderBy(desc(marketingCampaigns.updatedAt));
  return Promise.all(campaigns.map(async campaign => ({ campaign, audienceCount: await getCampaignAudienceCount(input.storeId, campaign) })));
}

export async function listApprovedContentPosts(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(contentPosts).where(and(eq(contentPosts.storeId, storeId), eq(contentPosts.status, "approved"))).orderBy(desc(contentPosts.updatedAt));
}

export async function listStoreTags(storeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(customerTags).where(eq(customerTags.storeId, storeId)).orderBy(customerTags.name);
}

export async function createMarketingCampaign(input: CampaignFields & { storeId: number; createdByUserId: number }) {
  if (!input.name?.trim()) throw new Error("اسم الحملة مطلوب.");
  if (!input.objective) throw new Error("اختاري هدف الحملة.");
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const audience = await normalizeAudience(input.storeId, { audienceType: input.audienceType ?? "all_customers", audienceTagId: input.audienceTagId, audienceStage: input.audienceStage });
  const result = await db.insert(marketingCampaigns).values({
    storeId: input.storeId,
    name: input.name.trim(),
    objective: input.objective,
    description: cleanText(input.description),
    ...audience,
    budgetAmount: money(input.budgetAmount),
    budgetCurrency: currency(input.budgetCurrency),
    createdByUserId: input.createdByUserId,
  });
  const campaignId = Number(result[0].insertId);
  await recordCampaignActivity({ storeId: input.storeId, campaignId, actorUserId: input.createdByUserId, action: "created", note: "أُنشئت حملة داخلية." });
  return campaignId;
}

export async function updateMarketingCampaign(input: CampaignFields & { storeId: number; campaignId: number; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const current = await getCampaignRow(input.campaignId, input.storeId);
  if (current.status === "archived") throw new Error("لا يمكن تعديل حملة مؤرشفة.");
  const audience = await normalizeAudience(input.storeId, {
    audienceType: input.audienceType ?? current.audienceType,
    audienceTagId: input.audienceTagId === undefined ? current.audienceTagId : input.audienceTagId,
    audienceStage: input.audienceStage === undefined ? current.audienceStage : input.audienceStage,
  });
  const fields = {
    name: input.name === undefined ? current.name : input.name.trim(),
    objective: input.objective ?? current.objective,
    description: input.description === undefined ? current.description : cleanText(input.description),
    ...audience,
    budgetAmount: money(input.budgetAmount, current.budgetAmount),
    budgetCurrency: input.budgetCurrency === undefined ? current.budgetCurrency : currency(input.budgetCurrency),
  };
  if (!fields.name) throw new Error("اسم الحملة مطلوب.");
  const reset = await resetApprovalIfNeeded(input.storeId, input.campaignId, current.status);
  await db.update(marketingCampaigns).set(fields).where(and(eq(marketingCampaigns.id, input.campaignId), eq(marketingCampaigns.storeId, input.storeId)));
  await recordCampaignActivity({ storeId: input.storeId, campaignId: input.campaignId, actorUserId: input.actorUserId, action: "updated", note: reset ? "عُدلت الحملة وأعيدت إلى مسودة لأن قرار الاعتماد السابق لم يعد ينطبق." : "عُدلت الحملة.", metadata: { approvalReset: reset } });
  return getCampaignDetail(input.campaignId, input.storeId);
}

export async function replaceCampaignContent(input: { storeId: number; campaignId: number; contentPostIds: number[]; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const current = await getCampaignRow(input.campaignId, input.storeId);
  if (current.status === "archived") throw new Error("لا يمكن تعديل حملة مؤرشفة.");
  const uniqueIds = Array.from(new Set(input.contentPostIds));
  if (uniqueIds.length) {
    const posts = await db.select({ id: contentPosts.id }).from(contentPosts).where(and(eq(contentPosts.storeId, input.storeId), eq(contentPosts.status, "approved"), inArray(contentPosts.id, uniqueIds)));
    if (posts.length !== uniqueIds.length) throw new Error("لا يمكن ربط سوى مسودات المحتوى المعتمدة ضمن المتجر الحالي.");
  }
  const reset = await resetApprovalIfNeeded(input.storeId, input.campaignId, current.status);
  await db.transaction(async tx => {
    await tx.delete(marketingCampaignContent).where(eq(marketingCampaignContent.campaignId, input.campaignId));
    if (uniqueIds.length) await tx.insert(marketingCampaignContent).values(uniqueIds.map(contentPostId => ({ campaignId: input.campaignId, contentPostId, linkedByUserId: input.actorUserId })));
  });
  await recordCampaignActivity({ storeId: input.storeId, campaignId: input.campaignId, actorUserId: input.actorUserId, action: uniqueIds.length ? "content_linked" : "content_unlinked", note: uniqueIds.length ? "حُدّث محتوى الحملة من المسودات المعتمدة." : "أزيلت مسودات المحتوى من الحملة.", metadata: { count: uniqueIds.length, approvalReset: reset } });
  return getCampaignDetail(input.campaignId, input.storeId);
}

export async function saveMarketingBudgetItem(input: { storeId: number; campaignId: number; budgetItemId?: number; actorUserId: number; name: string; description?: string | null; unitPrice: number; quantity: number }) {
  if (!input.name.trim()) throw new Error("اسم بند الميزانية مطلوب.");
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100000) throw new Error("كمية بند الميزانية يجب أن تكون رقماً صحيحاً موجباً.");
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const current = await getCampaignRow(input.campaignId, input.storeId);
  if (current.status === "archived") throw new Error("لا يمكن تعديل حملة مؤرشفة.");
  const reset = await resetApprovalIfNeeded(input.storeId, input.campaignId, current.status);
  const values = { name: input.name.trim(), description: cleanText(input.description), unitPrice: money(input.unitPrice), quantity: input.quantity };
  if (input.budgetItemId) {
    const [item] = await db.select({ id: marketingCampaignBudgetItems.id }).from(marketingCampaignBudgetItems).where(and(eq(marketingCampaignBudgetItems.id, input.budgetItemId), eq(marketingCampaignBudgetItems.campaignId, input.campaignId))).limit(1);
    if (!item) throw new Error("بند الميزانية غير موجود ضمن هذه الحملة.");
    await db.update(marketingCampaignBudgetItems).set(values).where(eq(marketingCampaignBudgetItems.id, input.budgetItemId));
  } else {
    await db.insert(marketingCampaignBudgetItems).values({ campaignId: input.campaignId, ...values });
  }
  await recordCampaignActivity({ storeId: input.storeId, campaignId: input.campaignId, actorUserId: input.actorUserId, action: "budget_updated", note: "حُدّث بند ميزانية تخطيطي.", metadata: { approvalReset: reset } });
  return getCampaignDetail(input.campaignId, input.storeId);
}

export async function removeMarketingBudgetItem(input: { storeId: number; campaignId: number; budgetItemId: number; actorUserId: number }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const current = await getCampaignRow(input.campaignId, input.storeId);
  const [item] = await db.select({ id: marketingCampaignBudgetItems.id }).from(marketingCampaignBudgetItems).where(and(eq(marketingCampaignBudgetItems.id, input.budgetItemId), eq(marketingCampaignBudgetItems.campaignId, input.campaignId))).limit(1);
  if (!item) throw new Error("بند الميزانية غير موجود ضمن هذه الحملة.");
  const reset = await resetApprovalIfNeeded(input.storeId, input.campaignId, current.status);
  await db.delete(marketingCampaignBudgetItems).where(eq(marketingCampaignBudgetItems.id, input.budgetItemId));
  await recordCampaignActivity({ storeId: input.storeId, campaignId: input.campaignId, actorUserId: input.actorUserId, action: "budget_updated", note: "أزيل بند ميزانية تخطيطي.", metadata: { approvalReset: reset, removed: true } });
  return getCampaignDetail(input.campaignId, input.storeId);
}

export async function requestCampaignApproval(input: { storeId: number; campaignId: number; actorUserId: number; note?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const campaign = await getCampaignRow(input.campaignId, input.storeId);
  if (campaign.status !== "draft" && campaign.status !== "changes_requested") throw new Error("لا يمكن طلب اعتماد الحملة في حالتها الحالية.");
  const links = await db.select({ post: contentPosts }).from(marketingCampaignContent).innerJoin(contentPosts, eq(marketingCampaignContent.contentPostId, contentPosts.id)).where(eq(marketingCampaignContent.campaignId, input.campaignId));
  if (!links.length || links.some(link => link.post.storeId !== input.storeId || link.post.status !== "approved")) throw new Error("اربطي بالحملة مسودة محتوى واحدة معتمدة على الأقل قبل طلب الاعتماد.");
  await db.update(marketingCampaigns).set({ status: "needs_approval", approvedByUserId: null, approvedAt: null, approvalNote: null }).where(eq(marketingCampaigns.id, input.campaignId));
  await recordCampaignActivity({ storeId: input.storeId, campaignId: input.campaignId, actorUserId: input.actorUserId, action: "approval_requested", note: input.note });
  try {
    await notifyPermissionHolders({ storeId: input.storeId, permissionCode: "marketing.approve", type: "marketing_approval_requested", priority: "action", title: `حملة بانتظار الاعتماد: ${campaign.name}`, body: input.note?.trim() || "راجعي الهدف والجمهور والمحتوى والميزانية التخطيطية قبل اتخاذ القرار.", entityType: "marketing_campaign", entityId: campaign.id, route: `/marketing?campaign=${campaign.id}` });
  } catch (error) {
    console.warn("[Notifications] تعذر إنشاء تنبيه اعتماد حملة:", error);
  }
  return { status: "needs_approval" as const };
}

export async function reviewMarketingCampaign(input: { storeId: number; campaignId: number; actorUserId: number; decision: "approved" | "changes_requested"; note?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  const campaign = await getCampaignRow(input.campaignId, input.storeId);
  if (campaign.status !== "needs_approval") throw new Error("لا يمكن اتخاذ قرار اعتماد إلا لحملة بانتظار الاعتماد.");
  await db.update(marketingCampaigns).set({ status: input.decision, approvalNote: cleanText(input.note), approvedByUserId: input.actorUserId, approvedAt: new Date() }).where(eq(marketingCampaigns.id, input.campaignId));
  await recordCampaignActivity({ storeId: input.storeId, campaignId: input.campaignId, actorUserId: input.actorUserId, action: input.decision, note: input.note });
  return { status: input.decision };
}

export async function archiveMarketingCampaign(input: { storeId: number; campaignId: number; actorUserId: number; note?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  await getCampaignRow(input.campaignId, input.storeId);
  await db.update(marketingCampaigns).set({ status: "archived" }).where(and(eq(marketingCampaigns.id, input.campaignId), eq(marketingCampaigns.storeId, input.storeId)));
  await recordCampaignActivity({ storeId: input.storeId, campaignId: input.campaignId, actorUserId: input.actorUserId, action: "archived", note: input.note });
  return { status: "archived" as const };
}

export async function getMarketingCampaign(campaignId: number, storeId: number) {
  return getCampaignDetail(campaignId, storeId);
}
