import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  customerProfiles,
  loyaltyActivities,
  loyaltyMemberships,
  loyaltyPointLedger,
  loyaltyPrograms,
  loyaltyRewards,
  loyaltyTiers,
  stores,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  createLoyaltyMembership,
  createLoyaltyProgram,
  createLoyaltyReward,
  getLoyaltyMembershipDetail,
  getLoyaltyOverview,
  recordLoyaltyPoints,
  requestLoyaltyRewardApproval,
  reviewLoyaltyReward,
  saveLoyaltyTier,
  setLoyaltyProgramStatus,
} from "./db";

describe("Loyalty-A: دفتر النقاط اليدوي غير المالي", () => {
  const storeIds: number[] = [];

  afterEach(async () => {
    const db = await getDb();
    if (!db) return;
    for (const storeId of storeIds.splice(0)) {
      await db.delete(loyaltyActivities).where(eq(loyaltyActivities.storeId, storeId));
      await db.delete(loyaltyRewards).where(eq(loyaltyRewards.storeId, storeId));
      await db.delete(loyaltyPointLedger).where(eq(loyaltyPointLedger.storeId, storeId));
      await db.delete(loyaltyMemberships).where(eq(loyaltyMemberships.storeId, storeId));
      const [program] = await db.select({ id: loyaltyPrograms.id }).from(loyaltyPrograms).where(eq(loyaltyPrograms.storeId, storeId)).limit(1);
      if (program) await db.delete(loyaltyTiers).where(eq(loyaltyTiers.programId, program.id));
      await db.delete(loyaltyPrograms).where(eq(loyaltyPrograms.storeId, storeId));
      await db.delete(customerProfiles).where(eq(customerProfiles.storeId, storeId));
      await db.delete(stores).where(eq(stores.id, storeId));
    }
  });

  it("يعزل العضوية ودفتر النقاط والمكافأة بين المتاجر ولا ينشئ أثراً مالياً", async () => {
    const db = await getDb();
    if (!db) throw new Error("قاعدة البيانات غير متاحة لاختبار Loyalty-A.");
    const [owner] = await db.select().from(users).limit(1);
    if (!owner) throw new Error("لا يوجد مستخدم مخول لاختبار Loyalty-A.");

    const firstStore = await db.insert(stores).values({ name: "متجر اختبار ولاء 1", slug: `loyalty-one-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const secondStore = await db.insert(stores).values({ name: "متجر اختبار ولاء 2", slug: `loyalty-two-${randomUUID().slice(0, 10)}`, primaryOwnerUserId: owner.id });
    const firstStoreId = Number(firstStore[0].insertId);
    const secondStoreId = Number(secondStore[0].insertId);
    storeIds.push(firstStoreId, secondStoreId);

    const firstCustomer = await db.insert(customerProfiles).values({ storeId: firstStoreId, displayName: "عميلة ولاء أولى", phoneNormalized: `96477${randomUUID().replace(/-/g, "").slice(0, 8)}`, phoneDisplay: "07700000001" });
    const secondCustomer = await db.insert(customerProfiles).values({ storeId: secondStoreId, displayName: "عميلة متجر ثان", phoneNormalized: `96478${randomUUID().replace(/-/g, "").slice(0, 8)}`, phoneDisplay: "07700000002" });
    const firstCustomerId = Number(firstCustomer[0].insertId);
    const secondCustomerId = Number(secondCustomer[0].insertId);

    const firstProgram = await createLoyaltyProgram({ storeId: firstStoreId, name: "نادي الأناقة", pointsLabel: "نقطة", actorUserId: owner.id });
    const secondProgram = await createLoyaltyProgram({ storeId: secondStoreId, name: "نادي متجر ثان", actorUserId: owner.id });
    const firstProgramId = firstProgram.program.id;
    const secondProgramId = secondProgram.program.id;
    await saveLoyaltyTier({ storeId: firstStoreId, programId: firstProgramId, name: "الأساسي", rank: 0, thresholdPoints: 0, isBase: true, actorUserId: owner.id });
    await saveLoyaltyTier({ storeId: secondStoreId, programId: secondProgramId, name: "مستوى ثان", rank: 0, thresholdPoints: 0, isBase: true, actorUserId: owner.id });
    const overview = await getLoyaltyOverview(firstStoreId);
    const baseTierId = overview.tiers[0]?.id;
    if (!baseTierId) throw new Error("لم ينشأ المستوى الأساسي للاختبار.");

    await setLoyaltyProgramStatus({ storeId: firstStoreId, programId: firstProgramId, status: "active", actorUserId: owner.id });
    await expect(createLoyaltyMembership({ storeId: firstStoreId, programId: firstProgramId, customerId: secondCustomerId, actorUserId: owner.id })).rejects.toThrow("لا ينتمي إلى المتجر التشغيلي");

    const member = await createLoyaltyMembership({ storeId: firstStoreId, programId: firstProgramId, customerId: firstCustomerId, tierId: baseTierId, actorUserId: owner.id });
    const membershipId = member.membership.id;
    await expect(createLoyaltyMembership({ storeId: firstStoreId, programId: firstProgramId, customerId: firstCustomerId, actorUserId: owner.id })).rejects.toThrow("عضو في برنامج الولاء بالفعل");
    await expect(getLoyaltyMembershipDetail({ storeId: secondStoreId, membershipId })).rejects.toThrow("غير موجودة ضمن المتجر التشغيلي");

    const award = await recordLoyaltyPoints({ storeId: firstStoreId, membershipId, direction: "credit", points: 120, reason: "manual_award", note: "مكافأة متابعة يدوية", actorUserId: owner.id });
    expect(award.balanceAfter).toBe(120);
    const deduction = await recordLoyaltyPoints({ storeId: firstStoreId, membershipId, direction: "debit", points: 20, reason: "manual_deduction", note: "تصحيح مراجَع", actorUserId: owner.id });
    expect(deduction.balanceAfter).toBe(100);
    await expect(recordLoyaltyPoints({ storeId: firstStoreId, membershipId, direction: "debit", points: 101, reason: "manual_deduction", note: "خصم غير مسموح", actorUserId: owner.id })).rejects.toThrow("رصيد النقاط سالباً");

    const reward = await createLoyaltyReward({ storeId: firstStoreId, programId: firstProgramId, membershipId, title: "هدية تقدير داخلية", description: "لا تنشئ كود خصم أو استبدالاً.", actorUserId: owner.id });
    await requestLoyaltyRewardApproval({ storeId: firstStoreId, rewardId: reward.rewardId, actorUserId: owner.id });
    await reviewLoyaltyReward({ storeId: firstStoreId, rewardId: reward.rewardId, decision: "approved", actorUserId: owner.id, note: "للمتابعة اليدوية فقط" });

    const detail = await getLoyaltyMembershipDetail({ storeId: firstStoreId, membershipId });
    expect(detail.membership.pointsBalance).toBe(100);
    expect(detail.ledger.map(entry => entry.pointsDelta)).toEqual([-20, 120]);
    expect(detail.rewards[0]).toMatchObject({ id: reward.rewardId, status: "approved", title: "هدية تقدير داخلية" });
    expect(detail.activities.map(activity => activity.type)).toEqual(expect.arrayContaining(["membership_joined", "points_recorded", "reward_created", "reward_approval_requested", "reward_approved"]));
    expect((await getLoyaltyOverview(secondStoreId)).memberships).toEqual([]);
  }, 20_000);
});
