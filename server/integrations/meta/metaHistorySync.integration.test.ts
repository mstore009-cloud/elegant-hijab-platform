import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { channelAccounts, channelWebhookEvents, inboxConversationEvents, inboxConversations, inboxMessageMedia, inboxMessages, metaAssets, metaConnections, metaHistorySyncJobs, stores, users } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { encryptMetaToken, metaAssetTokenContext, metaConnectionTokenContext } from "./tokenCipher";
import { ensureMetaHistorySyncJobs, processMetaHistorySyncJob } from "./historySync";

const cleanups: Array<{ storeId: number; userId: number }> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  const db = await getDb(); if (!db) return;
  for (const cleanup of cleanups.splice(0)) {
    const conversations = await db.select({ id: inboxConversations.id }).from(inboxConversations).where(eq(inboxConversations.storeId, cleanup.storeId));
    const conversationIds = conversations.map(row => row.id);
    const messages = conversationIds.length ? await db.select({ id: inboxMessages.id }).from(inboxMessages).where(inArray(inboxMessages.conversationId, conversationIds)) : [];
    if (messages.length) await db.delete(inboxMessageMedia).where(inArray(inboxMessageMedia.messageId, messages.map(row => row.id)));
    if (conversationIds.length) {
      await db.delete(inboxConversationEvents).where(inArray(inboxConversationEvents.conversationId, conversationIds));
      await db.delete(inboxMessages).where(inArray(inboxMessages.conversationId, conversationIds));
      await db.delete(inboxConversations).where(inArray(inboxConversations.id, conversationIds));
    }
    await db.delete(channelWebhookEvents).where(eq(channelWebhookEvents.storeId, cleanup.storeId));
    await db.delete(metaHistorySyncJobs).where(eq(metaHistorySyncJobs.storeId, cleanup.storeId));
    await db.delete(channelAccounts).where(eq(channelAccounts.storeId, cleanup.storeId));
    await db.delete(metaAssets).where(eq(metaAssets.storeId, cleanup.storeId));
    await db.delete(metaConnections).where(eq(metaConnections.storeId, cleanup.storeId));
    await db.delete(stores).where(eq(stores.id, cleanup.storeId));
    await db.delete(users).where(eq(users.id, cleanup.userId));
  }
});

describe("Meta history sync", () => {
  it("يستورد رسائل Messenger الواردة والصادرة كمصدر تاريخي دون Webhook أو lastInbound ويمنع التكرار", async () => {
    const db = await getDb(); if (!db) throw new Error("database unavailable");
    const suffix = randomUUID();
    const userResult = await db.insert(users).values({ openId: `history-${suffix}`, name: "مالك اختبار التاريخ", email: `history-${suffix}@example.test`, role: "admin" });
    const userId = Number(userResult[0].insertId);
    const storeResult = await db.insert(stores).values({ ownerUserId: userId, name: `متجر تاريخ ${suffix}`, slug: `history-${suffix}` });
    const storeId = Number(storeResult[0].insertId); cleanups.push({ storeId, userId });
    const connectionResult = await db.insert(metaConnections).values({ storeId, purpose: "unified", authMode: "external_business", templateVersion: 1, status: "connected", encryptedAccessToken: encryptMetaToken("user-token", metaConnectionTokenContext(storeId, "unified")), grantedScopes: "pages_messaging,pages_manage_metadata,pages_read_engagement", connectedByUserId: userId });
    const connectionId = Number(connectionResult[0].insertId);
    await db.insert(metaAssets).values({ storeId, connectionId, assetType: "page", externalId: `page-${suffix}`, displayName: "صفحة اختبار", encryptedAccessToken: encryptMetaToken("page-token", metaAssetTokenContext(storeId, `page-${suffix}`)), isSelected: true });
    const accountResult = await db.insert(channelAccounts).values({ storeId, channel: "messenger", providerAccountId: `page-${suffix}`, providerDisplayName: "صفحة اختبار", connectionStatus: "connected", createdByUserId: userId });
    const accountId = Number(accountResult[0].insertId);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith(`/page-${suffix}/conversations`)) return new Response(JSON.stringify({ data: [{ id: `thread-${suffix}`, participants: { data: [{ id: `page-${suffix}`, name: "المتجر" }, { id: `customer-${suffix}`, name: "العميلة" }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith(`/thread-${suffix}/messages`)) return new Response(JSON.stringify({ data: [
        { id: `mid-in-${suffix}`, type: "text", message: "مرحباً", reply_to: { id: `mid-root-${suffix}`, message: "الرسالة الأصلية" }, story_id: `story-${suffix}`, mentions: [{ id: `staff-${suffix}`, name: "الموظفة" }], created_time: "2026-08-01T10:00:00+0000", from: { id: `customer-${suffix}` }, to: { data: [{ id: `page-${suffix}` }] } },
        { id: `mid-out-${suffix}`, message: "أهلاً بك", created_time: "2026-08-01T10:01:00+0000", from: { id: `page-${suffix}` }, to: { data: [{ id: `customer-${suffix}` }] } },
      ] }), { status: 200, headers: { "content-type": "application/json" } });
      throw new Error(`unexpected graph call ${url.pathname}`);
    }));
    const jobs = await ensureMetaHistorySyncJobs(storeId, userId);
    expect(jobs).toHaveLength(1);
    expect(await processMetaHistorySyncJob(jobs[0].id)).toMatchObject({ processed: true, messages: 2 });
    const conversations = await db.select().from(inboxConversations).where(eq(inboxConversations.storeId, storeId));
    expect(conversations).toHaveLength(1);
    const messages = await db.select().from(inboxMessages).where(eq(inboxMessages.conversationId, conversations[0].id));
    expect(messages.map(row => ({ direction: row.direction, source: row.source }))).toEqual(expect.arrayContaining([{ direction: "inbound", source: "historical_sync" }, { direction: "outbound", source: "historical_sync" }]));
    const historicalMetadata = JSON.parse(messages.find(row => row.direction === "inbound")?.metadataJson ?? "{}");
    expect(historicalMetadata).toMatchObject({ messageType: "text", replyToExternalMessageId: `mid-root-${suffix}`, replyToBodyPreview: "الرسالة الأصلية", storyId: `story-${suffix}`, mentions: [{ id: `staff-${suffix}`, name: "الموظفة" }] });
    expect(await db.select().from(channelWebhookEvents).where(eq(channelWebhookEvents.storeId, storeId))).toHaveLength(0);
    const jobsAfterRepeat = await ensureMetaHistorySyncJobs(storeId, userId);
    expect(jobsAfterRepeat).toHaveLength(1);
    expect(jobsAfterRepeat[0].processedMessages).toBe(2);
    const [account] = await db.select().from(channelAccounts).where(eq(channelAccounts.id, accountId));
    expect(account.lastInboundAt).toBeNull();
    await db.update(metaHistorySyncJobs).set({ status: "pending", cursor: JSON.stringify({ conversationIndex: 0 }) }).where(eq(metaHistorySyncJobs.id, jobs[0].id));
    expect(await processMetaHistorySyncJob(jobs[0].id)).toMatchObject({ processed: true, messages: 0, duplicates: 2 });
    expect(await db.select().from(inboxMessages).where(eq(inboxMessages.conversationId, conversations[0].id))).toHaveLength(2);
  });

  it("يستورد تاريخ Instagram عبر صفحة Facebook المرتبطة ويعزله تحت معرف Instagram", async () => {
    const db = await getDb(); if (!db) throw new Error("database unavailable");
    const suffix = randomUUID();
    const userResult = await db.insert(users).values({ openId: `ig-history-${suffix}`, name: "مالك Instagram", email: `ig-history-${suffix}@example.test`, role: "admin" });
    const userId = Number(userResult[0].insertId);
    const storeResult = await db.insert(stores).values({ ownerUserId: userId, name: `متجر Instagram ${suffix}`, slug: `ig-history-${suffix}` });
    const storeId = Number(storeResult[0].insertId); cleanups.push({ storeId, userId });
    const connectionResult = await db.insert(metaConnections).values({ storeId, purpose: "unified", authMode: "external_business", templateVersion: 1, status: "connected", encryptedAccessToken: encryptMetaToken("user-token", metaConnectionTokenContext(storeId, "unified")), grantedScopes: "pages_messaging,instagram_manage_messages,pages_read_engagement", connectedByUserId: userId });
    const connectionId = Number(connectionResult[0].insertId);
    const pageId = `page-${suffix}`; const instagramId = `ig-${suffix}`;
    await db.insert(metaAssets).values({ storeId, connectionId, assetType: "page", externalId: pageId, displayName: "صفحة Instagram", encryptedAccessToken: encryptMetaToken("page-token", metaAssetTokenContext(storeId, pageId)), isSelected: true });
    await db.insert(metaAssets).values({ storeId, connectionId, assetType: "instagram", externalId: instagramId, displayName: "حساب Instagram", parentExternalId: pageId, isSelected: true });
    await db.insert(channelAccounts).values({ storeId, channel: "instagram", providerAccountId: instagramId, providerDisplayName: "حساب Instagram", connectionStatus: "connected", createdByUserId: userId });
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith(`/${pageId}/conversations`)) {
        expect(url.searchParams.get("platform")).toBe("instagram");
        return new Response(JSON.stringify({ data: [{ id: `ig-thread-${suffix}`, participants: { data: [{ id: instagramId, name: "المتجر" }, { id: `ig-customer-${suffix}`, name: "عميلة Instagram" }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname.endsWith(`/ig-thread-${suffix}/messages`)) return new Response(JSON.stringify({ data: [{ id: `ig-mid-${suffix}`, message: "هل اللون متوفر؟", created_time: "2026-08-02T10:00:00+0000", from: { id: `ig-customer-${suffix}` }, to: { data: [{ id: instagramId }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
      throw new Error(`unexpected graph call ${url.pathname}`);
    }));
    const jobs = await ensureMetaHistorySyncJobs(storeId, userId);
    expect(jobs).toHaveLength(1);
    expect(await processMetaHistorySyncJob(jobs[0].id)).toMatchObject({ processed: true, messages: 1 });
    const [conversation] = await db.select().from(inboxConversations).where(eq(inboxConversations.storeId, storeId));
    expect(conversation).toMatchObject({ channel: "instagram", externalConversationId: `instagram:ig-customer-${suffix}` });
    const [message] = await db.select().from(inboxMessages).where(eq(inboxMessages.conversationId, conversation.id));
    expect(message).toMatchObject({ direction: "inbound", source: "historical_sync", body: "هل اللون متوفر؟" });
  });

  it("يتابع cursors المحادثات والرسائل حتى تكتمل كل صفحات Messenger", async () => {
    const db = await getDb(); if (!db) throw new Error("database unavailable");
    const suffix = randomUUID();
    const userResult = await db.insert(users).values({ openId: `paged-history-${suffix}`, name: "مالك pagination", email: `paged-${suffix}@example.test`, role: "admin" });
    const userId = Number(userResult[0].insertId);
    const storeResult = await db.insert(stores).values({ ownerUserId: userId, name: `متجر pagination ${suffix}`, slug: `paged-${suffix}` });
    const storeId = Number(storeResult[0].insertId); cleanups.push({ storeId, userId });
    const pageId = `page-${suffix}`;
    const connectionResult = await db.insert(metaConnections).values({ storeId, purpose: "unified", authMode: "external_business", templateVersion: 1, status: "connected", encryptedAccessToken: encryptMetaToken("user-token", metaConnectionTokenContext(storeId, "unified")), grantedScopes: "pages_messaging,pages_manage_metadata,pages_read_engagement", connectedByUserId: userId });
    const connectionId = Number(connectionResult[0].insertId);
    await db.insert(metaAssets).values({ storeId, connectionId, assetType: "page", externalId: pageId, displayName: "صفحة pagination", encryptedAccessToken: encryptMetaToken("page-token", metaAssetTokenContext(storeId, pageId)), isSelected: true });
    await db.insert(channelAccounts).values({ storeId, channel: "messenger", providerAccountId: pageId, providerDisplayName: "صفحة pagination", connectionStatus: "connected", createdByUserId: userId });
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input)); const after = url.searchParams.get("after");
      if (url.pathname.endsWith(`/${pageId}/conversations`) && after === "conv-page-2") return new Response(JSON.stringify({ data: [{ id: `thread-b-${suffix}`, participants: { data: [{ id: pageId }, { id: `customer-b-${suffix}` }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith(`/${pageId}/conversations`)) return new Response(JSON.stringify({ data: [{ id: `thread-a-${suffix}`, participants: { data: [{ id: pageId }, { id: `customer-a-${suffix}` }] } }], paging: { cursors: { after: "conv-page-2" } } }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith(`/thread-a-${suffix}/messages`) && after === "message-page-2") return new Response(JSON.stringify({ data: [{ id: `mid-a2-${suffix}`, message: "الثانية", created_time: "2026-08-03T10:01:00+0000", from: { id: pageId } }] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith(`/thread-a-${suffix}/messages`)) return new Response(JSON.stringify({ data: [{ id: `mid-a1-${suffix}`, message: "الأولى", created_time: "2026-08-03T10:00:00+0000", from: { id: `customer-a-${suffix}` } }], paging: { cursors: { after: "message-page-2" } } }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.pathname.endsWith(`/thread-b-${suffix}/messages`)) return new Response(JSON.stringify({ data: [{ id: `mid-b1-${suffix}`, message: "الثالثة", created_time: "2026-08-03T10:02:00+0000", from: { id: `customer-b-${suffix}` } }] }), { status: 200, headers: { "content-type": "application/json" } });
      throw new Error(`unexpected graph call ${url.pathname}`);
    }));
    const [job] = await ensureMetaHistorySyncJobs(storeId, userId);
    for (let step = 0; step < 6; step += 1) {
      const result = await processMetaHistorySyncJob(job.id);
      if (result.processed && result.completed) break;
    }
    const [completed] = await db.select().from(metaHistorySyncJobs).where(eq(metaHistorySyncJobs.id, job.id));
    expect(completed).toMatchObject({ status: "completed", processedConversations: 2, processedMessages: 3 });
    const conversations = await db.select({ id: inboxConversations.id }).from(inboxConversations).where(eq(inboxConversations.storeId, storeId));
    const messages = await db.select().from(inboxMessages).where(inArray(inboxMessages.conversationId, conversations.map(row => row.id)));
    expect(conversations).toHaveLength(2);
    expect(messages).toHaveLength(3);
  });
});
