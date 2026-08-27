import { and, desc, eq } from "drizzle-orm";
import {
  customerProfiles,
  loyaltyActivities,
  loyaltyMemberships,
  loyaltyPointLedger,
  loyaltyPrograms,
  loyaltyRewards,
  loyaltyTiers,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { notifyPermissionHolders } from "../notifications/db";

export const loyaltyProgramStatuses = ["draft", "active", "paused", "archived"] as const;
export const loyaltyMembershipStatuses = ["active", "paused", "removed"] as const;
export const loyaltyRewardStatuses = ["draft", "needs_approval", "approved", "archived"] as const;
export const loyaltyLedgerReasons = ["manual_award", "manual_deduction", "correction"] as const;

export type LoyaltyProgramStatus = (typeof loyaltyProgramStatuses)[number];
export type LoyaltyMembershipStatus = (typeof loyaltyMembershipStatuses)[number];
export type LoyaltyRewardStatus = (typeof loyaltyRewardStatuses)[number];
export type LoyaltyLedgerReason = (typeof loyaltyLedgerReasons)[number];
type LoyaltyActivityType = "program_created" | "program_status_changed" | "tier_created" | "membership_joined" | "membership_status_changed" | "tier_assigned" | "points_recorded" | "reward_created" | "reward_approval_requested" | "reward_approved" | "reward_archived";

function cleanText(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  return value.trim() || null;
}

function requiredText(value: string, label: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} مطلوب.`);
  if (normalized.length > maximum) throw new Error(`${label} أطول من الحد المسموح.`);
  return normalized;
}

async function database() {
  const db = await getDb();
  if (!db) throw new Error("قاعدة البيانات غير متاحة حاليًا.");
  return db;
}

async function getProgramRow(db: any, storeId: number, programId: number) {
  const [program] = await db.select().from(loyaltyPrograms).where(and(eq(loyaltyPrograms.id, programId), eq(loyaltyPrograms.storeId, storeId))).limit(1);
  if (!program) throw new Error("برنامج الولاء غير موجود ضمن المتجر التشغيلي الحالي.");
  return program;
}

async function getMembershipRow(db: any, storeId: number, membershipId: number) {
  const [membership] = await db.select().from(loyaltyMemberships).where(and(eq(loyaltyMemberships.id, membershipId), eq(loyaltyMemberships.storeId, storeId))).limit(1);
  if (!membership) throw new Error("عضوية الولاء غير موجودة ضمن المتجر التشغيلي الحالي.");
  return membership;
}

async function assertCustomer(db: any, storeId: number, customerId: number) {
  const [customer] = await db.select({ id: customerProfiles.id }).from(customerProfiles).where(and(eq(customerProfiles.id, customerId), eq(customerProfiles.storeId, storeId))).limit(1);
  if (!customer) throw new Error("ملف العميل لا ينتمي إلى المتجر التشغيلي الحالي.");
}

async function assertTier(db: any, programId: number, tierId: number | null | undefined) {
  if (!tierId) return null;
  const [tier] = await db.select().from(loyaltyTiers).where(and(eq(loyaltyTiers.id, tierId), eq(loyaltyTiers.programId, programId))).limit(1);
  if (!tier) throw new Error("مستوى الولاء لا ينتمي إلى برنامج العميل.");
  return tier;
}

async function recordLoyaltyActivity(db: any, input: {
  storeId: number;
  programId: number;
  type: LoyaltyActivityType;
  actorUserId?: number | null;
  membershipId?: number | null;
  rewardId?: number | null;
  ledgerEntryId?: number | null;
  note?: string | null;
}) {
  await db.insert(loyaltyActivities).values({
    storeId: input.storeId,
    programId: input.programId,
    membershipId: input.membershipId ?? null,
    rewardId: input.rewardId ?? null,
    ledgerEntryId: input.ledgerEntryId ?? null,
    type: input.type,
    note: cleanText(input.note),
    actorUserId: input.actorUserId ?? null,
  });
}

async function loyaltyDetail(programId: number, storeId: number) {
  const db = await database();
  const program = await getProgramRow(db, storeId, programId);
  const [tiers, memberships, rewards, activities] = await Promise.all([
    db.select().from(loyaltyTiers).where(eq(loyaltyTiers.programId, programId)).orderBy(loyaltyTiers.rank),
    db.select({ membership: loyaltyMemberships, customer: { id: customerProfiles.id, displayName: customerProfiles.displayName, relationshipStage: customerProfiles.relationshipStage }, tier: loyaltyTiers })
      .from(loyaltyMemberships)
      .innerJoin(customerProfiles, eq(loyaltyMemberships.customerId, customerProfiles.id))
      .leftJoin(loyaltyTiers, eq(loyaltyMemberships.currentTierId, loyaltyTiers.id))
      .where(and(eq(loyaltyMemberships.storeId, storeId), eq(loyaltyMemberships.programId, programId)))
      .orderBy(desc(loyaltyMemberships.updatedAt)),
    db.select({ reward: loyaltyRewards, membership: loyaltyMemberships, customer: { id: customerProfiles.id, displayName: customerProfiles.displayName } })
      .from(loyaltyRewards)
      .innerJoin(loyaltyMemberships, eq(loyaltyRewards.membershipId, loyaltyMemberships.id))
      .innerJoin(customerProfiles, eq(loyaltyMemberships.customerId, customerProfiles.id))
      .where(and(eq(loyaltyRewards.storeId, storeId), eq(loyaltyRewards.programId, programId)))
      .orderBy(desc(loyaltyRewards.updatedAt)),
    db.select().from(loyaltyActivities).where(and(eq(loyaltyActivities.storeId, storeId), eq(loyaltyActivities.programId, programId))).orderBy(desc(loyaltyActivities.createdAt), desc(loyaltyActivities.id)).limit(100),
  ]);
  return { program, tiers, memberships, rewards, activities };
}

export async function getLoyaltyOverview(storeId: number) {
  const db = await database();
  const [program] = await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.storeId, storeId)).limit(1);
  if (!program) return { program: null, tiers: [], memberships: [], rewards: [], activities: [] };
  return loyaltyDetail(program.id, storeId);
}

export async function listLoyaltyCustomers(storeId: number) {
  const db = await database();
  return db.select({ id: customerProfiles.id, displayName: customerProfiles.displayName, relationshipStage: customerProfiles.relationshipStage, lastOrderAt: customerProfiles.lastOrderAt })
    .from(customerProfiles).where(eq(customerProfiles.storeId, storeId)).orderBy(customerProfiles.displayName).limit(250);
}

export async function getLoyaltyMembershipDetail(input: { storeId: number; membershipId: number }) {
  const db = await database();
  const membership = await getMembershipRow(db, input.storeId, input.membershipId);
  const [ledger, activities, rewards] = await Promise.all([
    db.select().from(loyaltyPointLedger).where(and(eq(loyaltyPointLedger.storeId, input.storeId), eq(loyaltyPointLedger.membershipId, input.membershipId))).orderBy(desc(loyaltyPointLedger.createdAt), desc(loyaltyPointLedger.id)),
    db.select().from(loyaltyActivities).where(and(eq(loyaltyActivities.storeId, input.storeId), eq(loyaltyActivities.membershipId, input.membershipId))).orderBy(desc(loyaltyActivities.createdAt), desc(loyaltyActivities.id)),
    db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.storeId, input.storeId), eq(loyaltyRewards.membershipId, input.membershipId))).orderBy(desc(loyaltyRewards.updatedAt)),
  ]);
  return { membership, ledger, activities, rewards };
}

export async function createLoyaltyProgram(input: { storeId: number; name: string; pointsLabel?: string | null; description?: string | null; actorUserId: number }) {
  const db = await database();
  const [existing] = await db.select({ id: loyaltyPrograms.id }).from(loyaltyPrograms).where(eq(loyaltyPrograms.storeId, input.storeId)).limit(1);
  if (existing) throw new Error("يوجد برنامج ولاء لهذا المتجر بالفعل.");
  const result = await db.insert(loyaltyPrograms).values({
    storeId: input.storeId,
    name: requiredText(input.name, "اسم البرنامج", 180),
    pointsLabel: requiredText(input.pointsLabel || "نقطة", "تسمية النقاط", 80),
    description: cleanText(input.description),
    createdByUserId: input.actorUserId,
  });
  const programId = Number(result[0].insertId);
  await recordLoyaltyActivity(db, { storeId: input.storeId, programId, actorUserId: input.actorUserId, type: "program_created", note: "أُنشئ برنامج ولاء كمسودة داخلية." });
  return loyaltyDetail(programId, input.storeId);
}

export async function updateLoyaltyProgram(input: { storeId: number; programId: number; name?: string; pointsLabel?: string; description?: string | null; actorUserId: number }) {
  const db = await database();
  const program = await getProgramRow(db, input.storeId, input.programId);
  if (program.status === "archived") throw new Error("لا يمكن تعديل برنامج ولاء مؤرشف.");
  await db.update(loyaltyPrograms).set({
    name: input.name === undefined ? program.name : requiredText(input.name, "اسم البرنامج", 180),
    pointsLabel: input.pointsLabel === undefined ? program.pointsLabel : requiredText(input.pointsLabel, "تسمية النقاط", 80),
    description: input.description === undefined ? program.description : cleanText(input.description),
  }).where(and(eq(loyaltyPrograms.id, input.programId), eq(loyaltyPrograms.storeId, input.storeId)));
  return loyaltyDetail(input.programId, input.storeId);
}

export async function setLoyaltyProgramStatus(input: { storeId: number; programId: number; status: LoyaltyProgramStatus; actorUserId: number; note?: string | null }) {
  const db = await database();
  const program = await getProgramRow(db, input.storeId, input.programId);
  if (program.status === "archived") throw new Error("لا يمكن إعادة تنشيط برنامج ولاء مؤرشف.");
  if (input.status === "draft") throw new Error("إعادة البرنامج إلى مسودة غير متاحة بعد تهيئته.");
  await db.update(loyaltyPrograms).set({
    status: input.status,
    activatedByUserId: input.status === "active" ? input.actorUserId : program.activatedByUserId,
    activatedAt: input.status === "active" ? new Date() : program.activatedAt,
  }).where(and(eq(loyaltyPrograms.id, input.programId), eq(loyaltyPrograms.storeId, input.storeId)));
  await recordLoyaltyActivity(db, { storeId: input.storeId, programId: input.programId, actorUserId: input.actorUserId, type: "program_status_changed", note: input.note || `حُدثت حالة برنامج الولاء إلى ${input.status}.` });
  return { status: input.status };
}

export async function saveLoyaltyTier(input: { storeId: number; programId: number; tierId?: number; name: string; rank: number; thresholdPoints?: number; benefitsSummary?: string | null; isBase?: boolean; actorUserId: number }) {
  if (!Number.isInteger(input.rank) || input.rank < 0 || input.rank > 99) throw new Error("ترتيب المستوى يجب أن يكون عدداً صحيحاً بين 0 و99.");
  if (!Number.isInteger(input.thresholdPoints ?? 0) || (input.thresholdPoints ?? 0) < 0) throw new Error("عتبة النقاط يجب أن تكون عدداً صحيحاً غير سالب.");
  const db = await database();
  const program = await getProgramRow(db, input.storeId, input.programId);
  if (program.status === "archived") throw new Error("لا يمكن تعديل برنامج ولاء مؤرشف.");
  const fields = { name: requiredText(input.name, "اسم المستوى", 120), rank: input.rank, thresholdPoints: input.thresholdPoints ?? 0, benefitsSummary: cleanText(input.benefitsSummary), isBase: Boolean(input.isBase) };
  await db.transaction(async tx => {
    if (fields.isBase) await tx.update(loyaltyTiers).set({ isBase: false }).where(eq(loyaltyTiers.programId, input.programId));
    if (input.tierId) {
      const [tier] = await tx.select({ id: loyaltyTiers.id }).from(loyaltyTiers).where(and(eq(loyaltyTiers.id, input.tierId), eq(loyaltyTiers.programId, input.programId))).limit(1);
      if (!tier) throw new Error("مستوى الولاء غير موجود ضمن البرنامج الحالي.");
      await tx.update(loyaltyTiers).set(fields).where(eq(loyaltyTiers.id, input.tierId));
    } else {
      await tx.insert(loyaltyTiers).values({ programId: input.programId, ...fields });
    }
    await recordLoyaltyActivity(tx, { storeId: input.storeId, programId: input.programId, actorUserId: input.actorUserId, type: "tier_created", note: input.tierId ? "عُدل مستوى ولاء يدوياً." : "أُنشئ مستوى ولاء يدوياً." });
  });
  return loyaltyDetail(input.programId, input.storeId);
}

export async function createLoyaltyMembership(input: { storeId: number; programId: number; customerId: number; tierId?: number | null; actorUserId: number }) {
  const db = await database();
  const program = await getProgramRow(db, input.storeId, input.programId);
  if (program.status !== "active") throw new Error("فعّلي برنامج الولاء قبل إضافة أعضاء.");
  await assertCustomer(db, input.storeId, input.customerId);
  await assertTier(db, input.programId, input.tierId);
  const [existing] = await db.select({ id: loyaltyMemberships.id }).from(loyaltyMemberships).where(and(eq(loyaltyMemberships.programId, input.programId), eq(loyaltyMemberships.customerId, input.customerId))).limit(1);
  if (existing) throw new Error("العميل عضو في برنامج الولاء بالفعل.");
  const result = await db.insert(loyaltyMemberships).values({ storeId: input.storeId, programId: input.programId, customerId: input.customerId, currentTierId: input.tierId ?? null, createdByUserId: input.actorUserId });
  const membershipId = Number(result[0].insertId);
  await recordLoyaltyActivity(db, { storeId: input.storeId, programId: input.programId, membershipId, actorUserId: input.actorUserId, type: "membership_joined", note: "أضيف العميل إلى برنامج الولاء يدوياً." });
  return getLoyaltyMembershipDetail({ storeId: input.storeId, membershipId });
}

export async function updateLoyaltyMembership(input: { storeId: number; membershipId: number; status?: LoyaltyMembershipStatus; tierId?: number | null; actorUserId: number; note?: string | null }) {
  const db = await database();
  const membership = await getMembershipRow(db, input.storeId, input.membershipId);
  await assertTier(db, membership.programId, input.tierId);
  const nextStatus = input.status ?? membership.status;
  const nextTierId = input.tierId === undefined ? membership.currentTierId : input.tierId;
  await db.update(loyaltyMemberships).set({ status: nextStatus, currentTierId: nextTierId }).where(and(eq(loyaltyMemberships.id, input.membershipId), eq(loyaltyMemberships.storeId, input.storeId)));
  if (nextStatus !== membership.status) await recordLoyaltyActivity(db, { storeId: input.storeId, programId: membership.programId, membershipId: input.membershipId, actorUserId: input.actorUserId, type: "membership_status_changed", note: input.note || `حُدثت حالة العضوية إلى ${nextStatus}.` });
  if (nextTierId !== membership.currentTierId) await recordLoyaltyActivity(db, { storeId: input.storeId, programId: membership.programId, membershipId: input.membershipId, actorUserId: input.actorUserId, type: "tier_assigned", note: input.note || "عُين مستوى الولاء يدوياً." });
  return getLoyaltyMembershipDetail({ storeId: input.storeId, membershipId: input.membershipId });
}

export async function recordLoyaltyPoints(input: { storeId: number; membershipId: number; direction: "credit" | "debit"; points: number; reason: LoyaltyLedgerReason; note: string; actorUserId: number }) {
  if (!Number.isInteger(input.points) || input.points <= 0 || input.points > 1_000_000) throw new Error("عدد النقاط يجب أن يكون عدداً صحيحاً موجباً ضمن الحد المسموح.");
  const db = await database();
  return db.transaction(async tx => {
    const membership = await getMembershipRow(tx, input.storeId, input.membershipId);
    if (membership.status !== "active") throw new Error("لا يمكن تسجيل نقاط لعضوية غير نشطة.");
    const delta = input.direction === "credit" ? input.points : -input.points;
    const balanceAfter = membership.pointsBalance + delta;
    if (balanceAfter < 0) throw new Error("لا يمكن أن يصبح رصيد النقاط سالباً.");
    const result = await tx.insert(loyaltyPointLedger).values({ storeId: input.storeId, programId: membership.programId, membershipId: membership.id, direction: input.direction, pointsDelta: delta, balanceAfter, reason: input.reason, note: requiredText(input.note, "سبب حركة النقاط", 4000), createdByUserId: input.actorUserId });
    const ledgerEntryId = Number(result[0].insertId);
    await tx.update(loyaltyMemberships).set({ pointsBalance: balanceAfter }).where(and(eq(loyaltyMemberships.id, membership.id), eq(loyaltyMemberships.storeId, input.storeId)));
    await recordLoyaltyActivity(tx, { storeId: input.storeId, programId: membership.programId, membershipId: membership.id, ledgerEntryId, actorUserId: input.actorUserId, type: "points_recorded", note: `سُجلت حركة نقاط يدوية: ${delta > 0 ? "+" : ""}${delta}.` });
    return { membershipId: membership.id, balanceAfter, ledgerEntryId };
  });
}

export async function createLoyaltyReward(input: { storeId: number; programId: number; membershipId: number; title: string; description?: string | null; actorUserId: number }) {
  const db = await database();
  await getProgramRow(db, input.storeId, input.programId);
  const membership = await getMembershipRow(db, input.storeId, input.membershipId);
  if (membership.programId !== input.programId) throw new Error("العضوية لا تنتمي إلى برنامج الولاء المحدد.");
  const result = await db.insert(loyaltyRewards).values({ storeId: input.storeId, programId: input.programId, membershipId: input.membershipId, title: requiredText(input.title, "عنوان المكافأة", 180), description: cleanText(input.description), createdByUserId: input.actorUserId });
  const rewardId = Number(result[0].insertId);
  await recordLoyaltyActivity(db, { storeId: input.storeId, programId: input.programId, membershipId: input.membershipId, rewardId, actorUserId: input.actorUserId, type: "reward_created", note: "أُنشئت مكافأة داخلية كمسودة؛ لا تنشئ خصماً أو قسيمة." });
  return { rewardId, status: "draft" as const };
}

export async function requestLoyaltyRewardApproval(input: { storeId: number; rewardId: number; actorUserId: number; note?: string | null }) {
  const db = await database();
  const [reward] = await db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, input.rewardId), eq(loyaltyRewards.storeId, input.storeId))).limit(1);
  if (!reward) throw new Error("المكافأة غير موجودة ضمن المتجر الحالي.");
  if (reward.status !== "draft") throw new Error("لا يمكن طلب اعتماد المكافأة في حالتها الحالية.");
  await db.update(loyaltyRewards).set({ status: "needs_approval", decisionNote: null, approvedByUserId: null, approvedAt: null }).where(eq(loyaltyRewards.id, input.rewardId));
  await recordLoyaltyActivity(db, { storeId: input.storeId, programId: reward.programId, membershipId: reward.membershipId, rewardId: reward.id, actorUserId: input.actorUserId, type: "reward_approval_requested", note: input.note || "طُلب اعتماد مكافأة داخلية." });
  try {
    await notifyPermissionHolders({ storeId: input.storeId, permissionCode: "loyalty.approve", type: "loyalty_reward_review_requested", priority: "action", title: `مكافأة ولاء بانتظار الاعتماد: ${reward.title}`, body: input.note?.trim() || "راجعي المكافأة الداخلية؛ اعتمادها لا ينشئ خصماً أو قسيمة.", entityType: "loyalty_reward", entityId: reward.id, route: `/loyalty?reward=${reward.id}` });
  } catch (error) {
    console.warn("[Notifications] تعذر إنشاء تنبيه اعتماد مكافأة:", error);
  }
  return { status: "needs_approval" as const };
}

export async function reviewLoyaltyReward(input: { storeId: number; rewardId: number; decision: "approved" | "archived"; actorUserId: number; note?: string | null }) {
  const db = await database();
  const [reward] = await db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, input.rewardId), eq(loyaltyRewards.storeId, input.storeId))).limit(1);
  if (!reward) throw new Error("المكافأة غير موجودة ضمن المتجر الحالي.");
  if (reward.status !== "needs_approval") throw new Error("لا يمكن اتخاذ قرار إلا لمكافأة بانتظار الاعتماد.");
  await db.update(loyaltyRewards).set({ status: input.decision, approvedByUserId: input.actorUserId, approvedAt: new Date(), decisionNote: cleanText(input.note) }).where(eq(loyaltyRewards.id, input.rewardId));
  await recordLoyaltyActivity(db, { storeId: input.storeId, programId: reward.programId, membershipId: reward.membershipId, rewardId: reward.id, actorUserId: input.actorUserId, type: input.decision === "approved" ? "reward_approved" : "reward_archived", note: input.note || (input.decision === "approved" ? "اعتُمدت مكافأة داخلية؛ لا تنشئ خصماً أو قسيمة." : "أرشفت مكافأة قبل اعتمادها.") });
  return { status: input.decision };
}

export async function archiveLoyaltyReward(input: { storeId: number; rewardId: number; actorUserId: number; note?: string | null }) {
  const db = await database();
  const [reward] = await db.select().from(loyaltyRewards).where(and(eq(loyaltyRewards.id, input.rewardId), eq(loyaltyRewards.storeId, input.storeId))).limit(1);
  if (!reward) throw new Error("المكافأة غير موجودة ضمن المتجر الحالي.");
  if (reward.status === "archived") return { status: "archived" as const };
  await db.update(loyaltyRewards).set({ status: "archived", decisionNote: cleanText(input.note) }).where(eq(loyaltyRewards.id, input.rewardId));
  await recordLoyaltyActivity(db, { storeId: input.storeId, programId: reward.programId, membershipId: reward.membershipId, rewardId: reward.id, actorUserId: input.actorUserId, type: "reward_archived", note: input.note || "أرشفت مكافأة داخلية." });
  return { status: "archived" as const };
}
