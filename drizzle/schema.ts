import { boolean, decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

const orderStatuses = ["new", "needs_contact", "confirmed", "preparing", "out_for_delivery", "completed", "cancelled"] as const;

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Operational store boundary. V1 exposes one store per account, while this
 * table is the durable parent for future store-scoped business data.
 */
export const stores = mysqlTable(
  "stores",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 180 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    status: mysqlEnum("status", ["active", "suspended"]).default("active").notNull(),
    primaryOwnerUserId: int("primaryOwnerUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("stores_status_idx").on(table.status), index("stores_owner_idx").on(table.primaryOwnerUserId)],
);

export type Store = typeof stores.$inferSelect;

/**
 * Append-only audit evidence for sensitive operational changes. Metadata stays
 * structured JSON at the application boundary and never stores secrets.
 */
export const auditEvents = mysqlTable(
  "audit_events",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    actorUserId: int("actorUserId").references(() => users.id),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: varchar("entityId", { length: 160 }).notNull(),
    action: varchar("action", { length: 120 }).notNull(),
    summary: varchar("summary", { length: 500 }).notNull(),
    metadata: text("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("audit_store_created_idx").on(table.storeId, table.createdAt),
    index("audit_entity_idx").on(table.entityType, table.entityId),
    index("audit_actor_idx").on(table.actorUserId),
  ],
);

export type AuditEvent = typeof auditEvents.$inferSelect;

/**
 * Operational staff profile. Authentication stays on `users`; this table holds
 * the business identity that receives granular permissions.
 */
export const employeeProfiles = mysqlTable("employee_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id),
  storeId: int("storeId").notNull().references(() => stores.id),
  displayName: varchar("displayName", { length: 160 }).notNull(),
  jobTitle: varchar("jobTitle", { length: 160 }),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * Atomic operation grants. A user can have any combination of permissions
 * without being forced into a broad role such as "products" or "orders".
 */
export const employeePermissionGrants = mysqlTable(
  "employee_permission_grants",
  {
    id: int("id").autoincrement().primaryKey(),
    employeeId: int("employeeId").notNull().references(() => employeeProfiles.id),
    permissionCode: varchar("permissionCode", { length: 96 }).notNull(),
    grantedByUserId: int("grantedByUserId").references(() => users.id),
    grantedAt: timestamp("grantedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("employee_permission_unique").on(table.employeeId, table.permissionCode),
    index("permission_code_idx").on(table.permissionCode),
  ],
);

export type EmployeeProfile = typeof employeeProfiles.$inferSelect;
export type InsertEmployeeProfile = typeof employeeProfiles.$inferInsert;
export type EmployeePermissionGrant = typeof employeePermissionGrants.$inferSelect;

export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    productCode: varchar("productCode", { length: 80 }).notNull(),
    name: varchar("name", { length: 220 }).notNull(),
    category: varchar("category", { length: 120 }),
    description: text("description"),
    sizeLabels: text("sizeLabels"),
    status: mysqlEnum("status", ["draft", "needs_review", "ready", "active", "archived"]).default("draft").notNull(),
    sellingPrice: decimal("sellingPrice", { precision: 12, scale: 2 }).notNull(),
    costPrice: decimal("costPrice", { precision: 12, scale: 2 }),
    targetMarginPercent: decimal("targetMarginPercent", { precision: 5, scale: 2 }),
    createdByUserId: int("createdByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("product_store_code_unique").on(table.storeId, table.productCode),
    index("product_store_status_idx").on(table.storeId, table.status),
    index("product_status_idx").on(table.status),
    index("product_category_idx").on(table.category),
  ],
);

export const productVariants = mysqlTable(
  "product_variants",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("productId").notNull().references(() => products.id),
    colorName: varchar("colorName", { length: 100 }).notNull(),
    sizeLabel: varchar("sizeLabel", { length: 80 }).default("").notNull(),
    inventoryQuantity: int("inventoryQuantity").default(0).notNull(),
    availability: mysqlEnum("availability", ["available", "low_stock", "out_of_stock"]).default("available").notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("product_variant_unique").on(table.productId, table.colorName, table.sizeLabel),
    index("variant_product_idx").on(table.productId),
  ],
);

/** Retail CRM is customer-centric: one profile per normalized phone in each store. */
export const customerProfiles = mysqlTable(
  "customer_profiles",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    displayName: varchar("displayName", { length: 160 }).notNull(),
    phoneNormalized: varchar("phoneNormalized", { length: 40 }).notNull(),
    phoneDisplay: varchar("phoneDisplay", { length: 40 }).notNull(),
    governorate: varchar("governorate", { length: 120 }),
    lastAddress: text("lastAddress"),
    relationshipStage: mysqlEnum("relationshipStage", ["new", "active", "repeat", "needs_followup", "inactive"]).default("new").notNull(),
    firstChannel: mysqlEnum("firstChannel", ["storefront", "whatsapp", "instagram", "messenger", "manual"]).default("storefront").notNull(),
    lastChannel: mysqlEnum("lastChannel", ["storefront", "whatsapp", "instagram", "messenger", "manual"]).default("storefront").notNull(),
    firstOrderAt: timestamp("firstOrderAt"),
    lastOrderAt: timestamp("lastOrderAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("customer_store_phone_unique").on(table.storeId, table.phoneNormalized),
    index("customer_store_stage_idx").on(table.storeId, table.relationshipStage),
    index("customer_store_last_order_idx").on(table.storeId, table.lastOrderAt),
  ],
);

export const customerTags = mysqlTable(
  "customer_tags",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    name: varchar("name", { length: 80 }).notNull(),
    color: varchar("color", { length: 24 }).default("slate").notNull(),
    createdByUserId: int("createdByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("customer_tag_store_name_unique").on(table.storeId, table.name), index("customer_tag_store_idx").on(table.storeId)],
);

export const customerTagAssignments = mysqlTable(
  "customer_tag_assignments",
  {
    id: int("id").autoincrement().primaryKey(),
    customerId: int("customerId").notNull().references(() => customerProfiles.id),
    tagId: int("tagId").notNull().references(() => customerTags.id),
    assignedByUserId: int("assignedByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("customer_tag_assignment_unique").on(table.customerId, table.tagId), index("customer_tag_assignment_customer_idx").on(table.customerId), index("customer_tag_assignment_tag_idx").on(table.tagId)],
);

export const customerTasks = mysqlTable(
  "customer_tasks",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    customerId: int("customerId").notNull().references(() => customerProfiles.id),
    title: varchar("title", { length: 220 }).notNull(),
    note: text("note"),
    status: mysqlEnum("status", ["open", "completed", "cancelled"]).default("open").notNull(),
    dueAt: timestamp("dueAt"),
    assigneeEmployeeId: int("assigneeEmployeeId").references(() => employeeProfiles.id),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("customer_task_store_status_idx").on(table.storeId, table.status), index("customer_task_customer_idx").on(table.customerId), index("customer_task_assignee_idx").on(table.assigneeEmployeeId)],
);

export const customerActivities = mysqlTable(
  "customer_activities",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    customerId: int("customerId").notNull().references(() => customerProfiles.id),
    type: mysqlEnum("type", ["profile_created", "profile_updated", "order_created", "order_status_changed", "note", "tag_added", "tag_removed", "task_created", "task_completed", "inbox_message"]).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    body: text("body"),
    actorUserId: int("actorUserId").references(() => users.id),
    orderId: int("orderId"),
    taskId: int("taskId"),
    occurredAt: timestamp("occurredAt").defaultNow().notNull(),
  },
  table => [index("customer_activity_store_customer_idx").on(table.storeId, table.customerId, table.occurredAt), index("customer_activity_order_idx").on(table.orderId), index("customer_activity_task_idx").on(table.taskId)],
);

/**
 * A store-scoped shared conversation. Channel identifiers remain nullable until
 * a verified external connector is enabled; manual operational records never
 * claim to have sent a message through an external provider.
 */
export const inboxConversations = mysqlTable(
  "inbox_conversations",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    customerId: int("customerId").references(() => customerProfiles.id),
    orderId: int("orderId").references(() => orders.id),
    channel: mysqlEnum("channel", ["manual", "whatsapp", "instagram", "messenger"]).default("manual").notNull(),
    externalConversationId: varchar("externalConversationId", { length: 255 }),
    contactNameSnapshot: varchar("contactNameSnapshot", { length: 160 }),
    contactPhoneSnapshot: varchar("contactPhoneSnapshot", { length: 40 }),
    subject: varchar("subject", { length: 240 }),
    status: mysqlEnum("status", ["open", "waiting_customer", "snoozed", "closed"]).default("open").notNull(),
    priority: boolean("priority").default(false).notNull(),
    assignedEmployeeId: int("assignedEmployeeId").references(() => employeeProfiles.id),
    lastMessageAt: timestamp("lastMessageAt"),
    snoozedUntil: timestamp("snoozedUntil"),
    closedAt: timestamp("closedAt"),
    createdByUserId: int("createdByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("inbox_external_conversation_unique").on(table.storeId, table.channel, table.externalConversationId),
    index("inbox_store_status_recent_idx").on(table.storeId, table.status, table.lastMessageAt),
    index("inbox_store_assignee_status_idx").on(table.storeId, table.assignedEmployeeId, table.status),
    index("inbox_store_customer_idx").on(table.storeId, table.customerId),
    index("inbox_store_order_idx").on(table.storeId, table.orderId),
  ],
);

/** Append-only message record. Internal notes are stored separately from customer-facing traffic. */
export const inboxMessages = mysqlTable(
  "inbox_messages",
  {
    id: int("id").autoincrement().primaryKey(),
    conversationId: int("conversationId").notNull().references(() => inboxConversations.id),
    direction: mysqlEnum("direction", ["inbound", "outbound", "internal_note", "system"]).notNull(),
    body: text("body").notNull(),
    externalMessageId: varchar("externalMessageId", { length: 255 }),
    actorUserId: int("actorUserId").references(() => users.id),
    occurredAt: timestamp("occurredAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("inbox_external_message_unique").on(table.conversationId, table.externalMessageId),
    index("inbox_message_conversation_time_idx").on(table.conversationId, table.occurredAt),
    index("inbox_message_actor_idx").on(table.actorUserId),
  ],
);

/** Append-only operational evidence for changes to a conversation. */
export const inboxConversationEvents = mysqlTable(
  "inbox_conversation_events",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    conversationId: int("conversationId").notNull().references(() => inboxConversations.id),
    type: mysqlEnum("type", ["created", "assigned", "status_changed", "priority_changed", "snoozed", "customer_linked", "order_linked", "message_recorded", "internal_note_added"]).notNull(),
    actorUserId: int("actorUserId").references(() => users.id),
    fromValue: varchar("fromValue", { length: 255 }),
    toValue: varchar("toValue", { length: 255 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("inbox_event_store_conversation_time_idx").on(table.storeId, table.conversationId, table.createdAt),
    index("inbox_event_conversation_idx").on(table.conversationId),
  ],
);

/** Store-scoped controls for the hybrid customer assistant. Automated sending stays disabled by default. */
export const customerBotSettings = mysqlTable(
  "customer_bot_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    enabled: boolean("enabled").default(false).notNull(),
    mode: mysqlEnum("mode", ["draft_only", "auto_reply"]).default("draft_only").notNull(),
    fastModel: varchar("fastModel", { length: 80 }).default("gpt-5-mini").notNull(),
    escalationModel: varchar("escalationModel", { length: 80 }).default("gpt-5").notNull(),
    minimumConfidence: int("minimumConfidence").default(75).notNull(),
    maxDailyReplies: int("maxDailyReplies").default(100).notNull(),
    maxDailyEscalations: int("maxDailyEscalations").default(15).notNull(),
    updatedByUserId: int("updatedByUserId").references(() => users.id),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("bot_settings_store_unique").on(table.storeId)],
);

/** Immutable evidence of a proposed reply, escalation decision, or human handoff. */
export const customerBotRuns = mysqlTable(
  "customer_bot_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    conversationId: int("conversationId").notNull().references(() => inboxConversations.id),
    sourceMessageId: int("sourceMessageId").references(() => inboxMessages.id),
    route: mysqlEnum("route", ["fast", "escalated", "human_handoff"]).notNull(),
    status: mysqlEnum("status", ["draft", "handoff", "failed", "dismissed"]).notNull(),
    model: varchar("model", { length: 80 }),
    confidence: int("confidence"),
    escalationReason: varchar("escalationReason", { length: 120 }),
    factsSnapshot: text("factsSnapshot"),
    replyDraft: text("replyDraft"),
    errorSummary: varchar("errorSummary", { length: 500 }),
    promptTokens: int("promptTokens"),
    completionTokens: int("completionTokens"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("bot_runs_store_conversation_time").on(table.storeId, table.conversationId, table.createdAt),
    index("bot_runs_store_route_time").on(table.storeId, table.route, table.createdAt),
    index("bot_runs_source_message_idx").on(table.sourceMessageId),
  ],
);

/** Daily store-scoped caps so a misconfigured bot cannot create unbounded model usage. */
export const customerBotUsageCounters = mysqlTable(
  "customer_bot_usage_counters",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    usageDate: varchar("usageDate", { length: 10 }).notNull(),
    fastReplyCount: int("fastReplyCount").default(0).notNull(),
    escalationCount: int("escalationCount").default(0).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("bot_usage_store_date_unique").on(table.storeId, table.usageDate)],
);

/** Human-curated knowledge. Only approved articles can be provided to the customer assistant. */
export const customerBotKnowledgeArticles = mysqlTable(
  "customer_bot_knowledge_articles",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    title: varchar("title", { length: 240 }).notNull(),
    kind: mysqlEnum("kind", ["faq", "policy", "style_guidance", "product_guidance"]).default("faq").notNull(),
    body: text("body").notNull(),
    status: mysqlEnum("status", ["draft", "approved", "archived"]).default("draft").notNull(),
    source: mysqlEnum("source", ["manual", "review_feedback", "historical_candidate"]).default("manual").notNull(),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    approvedByUserId: int("approvedByUserId").references(() => users.id),
    approvedAt: timestamp("approvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("bot_knowledge_store_status_time").on(table.storeId, table.status, table.updatedAt),
    index("bot_knowledge_store_kind_time").on(table.storeId, table.kind, table.updatedAt),
  ],
);

/** A single staff review records how a bot proposal was handled without mutating the original run. */
export const customerBotRunReviews = mysqlTable(
  "customer_bot_run_reviews",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    runId: int("runId").notNull().references(() => customerBotRuns.id),
    outcome: mysqlEnum("outcome", ["approved_as_is", "approved_edited", "rejected", "human_handoff", "knowledge_gap"]).notNull(),
    finalReply: text("finalReply"),
    feedback: text("feedback"),
    reviewedByUserId: int("reviewedByUserId").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("bot_run_review_unique").on(table.runId),
    index("bot_review_store_outcome_time").on(table.storeId, table.outcome, table.updatedAt),
  ],
);

/** Exact approved knowledge candidates provided as context for a particular bot run. */
export const customerBotRunKnowledgeSources = mysqlTable(
  "customer_bot_run_knowledge_sources",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    runId: int("runId").notNull().references(() => customerBotRuns.id),
    knowledgeArticleId: int("knowledgeArticleId").notNull().references(() => customerBotKnowledgeArticles.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("bot_run_knowledge_unique").on(table.runId, table.knowledgeArticleId),
    index("bot_knowledge_source_store_run").on(table.storeId, table.runId),
  ],
);

/** An explicit, reviewable knowledge or process gap. It never creates knowledge automatically. */
export const customerBotKnowledgeGaps = mysqlTable(
  "customer_bot_knowledge_gaps",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    runId: int("runId").references(() => customerBotRuns.id),
    category: mysqlEnum("category", ["knowledge", "policy", "handoff", "experience", "action"]).default("knowledge").notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    questionSnapshot: text("questionSnapshot"),
    status: mysqlEnum("status", ["open", "resolved", "dismissed"]).default("open").notNull(),
    resolutionNote: text("resolutionNote"),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    resolvedByUserId: int("resolvedByUserId").references(() => users.id),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("bot_gap_store_status_time").on(table.storeId, table.status, table.updatedAt),
    index("bot_gap_store_run_idx").on(table.storeId, table.runId),
  ],
);

export type CustomerProfile = typeof customerProfiles.$inferSelect;
export type InboxConversation = typeof inboxConversations.$inferSelect;
export type InboxMessage = typeof inboxMessages.$inferSelect;
export type CustomerBotSettings = typeof customerBotSettings.$inferSelect;
export type CustomerBotRun = typeof customerBotRuns.$inferSelect;
export type CustomerBotKnowledgeArticle = typeof customerBotKnowledgeArticles.$inferSelect;
export type CustomerBotRunReview = typeof customerBotRunReviews.$inferSelect;
export type CustomerBotKnowledgeGap = typeof customerBotKnowledgeGaps.$inferSelect;

/** Customer request created from the public store or future staff/WhatsApp channels. */
export const orders = mysqlTable(
  "orders",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    orderNumber: varchar("orderNumber", { length: 40 }).notNull().unique(),
    status: mysqlEnum("status", orderStatuses).default("new").notNull(),
    source: mysqlEnum("source", ["storefront", "manual", "whatsapp"]).default("storefront").notNull(),
    customerChannel: mysqlEnum("customerChannel", ["storefront", "whatsapp", "instagram", "messenger", "manual"]).default("storefront").notNull(),
    customerName: varchar("customerName", { length: 160 }).notNull(),
    customerPhone: varchar("customerPhone", { length: 40 }).notNull(),
    customerId: int("customerId").references(() => customerProfiles.id),
    governorate: varchar("governorate", { length: 120 }).notNull(),
    address: text("address").notNull(),
    customerNote: text("customerNote"),
    paymentMethod: mysqlEnum("paymentMethod", ["cash_on_delivery"]).default("cash_on_delivery").notNull(),
    subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
    deliveryFee: decimal("deliveryFee", { precision: 12, scale: 2 }).default("0.00").notNull(),
    manualDiscount: decimal("manualDiscount", { precision: 12, scale: 2 }).default("0.00").notNull(),
    total: decimal("total", { precision: 12, scale: 2 }).default("0.00").notNull(),
    inventoryDeductedAt: timestamp("inventoryDeductedAt"),
    confirmedByUserId: int("confirmedByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("orders_store_created_idx").on(table.storeId, table.createdAt), index("orders_status_idx").on(table.status), index("orders_phone_idx").on(table.customerPhone), index("orders_customer_idx").on(table.customerId), index("orders_created_idx").on(table.createdAt)],
);

/** Delivery fee configured by staff; a carrier integration can replace this source later. */
export const deliveryGovernorateRates = mysqlTable(
  "delivery_governorate_rates",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    governorate: varchar("governorate", { length: 120 }).notNull(),
    fee: decimal("fee", { precision: 12, scale: 2 }).default("0.00").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    updatedByUserId: int("updatedByUserId").references(() => users.id),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("delivery_store_governorate_unique").on(table.storeId, table.governorate), index("delivery_governorate_rates_enabled_idx").on(table.enabled)],
);

/** Singleton-style operating settings for the public store. */
export const storeSettings = mysqlTable(
  "store_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    defaultLanguage: varchar("defaultLanguage", { length: 16 }).default("ar").notNull(),
    currencyCode: varchar("currencyCode", { length: 8 }).default("IQD").notNull(),
    defaultDeliveryFee: decimal("defaultDeliveryFee", { precision: 12, scale: 2 }).default("0.00").notNull(),
    freeDeliveryEnabled: boolean("freeDeliveryEnabled").default(false).notNull(),
    freeDeliveryThreshold: decimal("freeDeliveryThreshold", { precision: 12, scale: 2 }),
    updatedByUserId: int("updatedByUserId").references(() => users.id),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("store_settings_store_unique").on(table.storeId)],
);

export const promotionCoupons = mysqlTable(
  "promotion_coupons",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    code: varchar("code", { length: 80 }).notNull(),
    discountType: mysqlEnum("discountType", ["fixed", "percent"]).notNull(),
    discountValue: decimal("discountValue", { precision: 12, scale: 2 }).notNull(),
    minimumSubtotal: decimal("minimumSubtotal", { precision: 12, scale: 2 }).default("0.00").notNull(),
    startsAt: timestamp("startsAt"),
    endsAt: timestamp("endsAt"),
    usageLimit: int("usageLimit"),
    usageCount: int("usageCount").default(0).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdByUserId: int("createdByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("promotion_coupon_store_code_unique").on(table.storeId, table.code), index("promotion_coupons_enabled_idx").on(table.enabled)],
);

/** Immutable selling snapshot; later product changes never rewrite an order item. */
export const orderItems = mysqlTable(
  "order_items",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull().references(() => orders.id),
    productId: int("productId").notNull().references(() => products.id),
    variantId: int("variantId").notNull().references(() => productVariants.id),
    productCodeSnapshot: varchar("productCodeSnapshot", { length: 80 }).notNull(),
    productNameSnapshot: varchar("productNameSnapshot", { length: 220 }).notNull(),
    colorNameSnapshot: varchar("colorNameSnapshot", { length: 100 }).notNull(),
    imageStorageKeySnapshot: varchar("imageStorageKeySnapshot", { length: 512 }),
    unitPriceSnapshot: decimal("unitPriceSnapshot", { precision: 12, scale: 2 }).notNull(),
    quantity: int("quantity").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("order_items_order_idx").on(table.orderId), index("order_items_product_idx").on(table.productId), uniqueIndex("order_item_variant_unique").on(table.orderId, table.variantId)],
);

/** Append-only audit trail of internal transitions; no status is silently overwritten. */
export const orderStatusEvents = mysqlTable(
  "order_status_events",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull().references(() => orders.id),
    fromStatus: varchar("fromStatus", { length: 32 }),
    toStatus: mysqlEnum("toStatus", orderStatuses).notNull(),
    actorUserId: int("actorUserId").references(() => users.id),
    source: mysqlEnum("source", ["storefront", "orders_ui", "whatsapp"]).notNull(),
    note: text("note"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("order_events_order_idx").on(table.orderId), index("order_events_status_idx").on(table.toStatus)],
);

/** Internal record of contact attempts; the external channel integration is added separately. */
export const orderContactEvents = mysqlTable(
  "order_contact_events",
  {
    id: int("id").autoincrement().primaryKey(),
    orderId: int("orderId").notNull().references(() => orders.id),
    channel: mysqlEnum("channel", ["storefront", "whatsapp", "instagram", "messenger", "manual"]).notNull(),
    outcome: mysqlEnum("outcome", ["attempted", "no_answer", "customer_confirmed", "customer_requested_change", "cancelled"]).notNull(),
    note: text("note"),
    actorUserId: int("actorUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("order_contact_order_idx").on(table.orderId), index("order_contact_channel_idx").on(table.channel)],
);

export const productMedia = mysqlTable(
  "product_media",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("productId").notNull().references(() => products.id),
    variantId: int("variantId").references(() => productVariants.id),
    source: mysqlEnum("source", ["onedrive", "manual", "s3"]).notNull(),
    mediaType: mysqlEnum("mediaType", ["image", "video", "document"]).notNull(),
    originalUrl: text("originalUrl"),
    storageKey: varchar("storageKey", { length: 512 }),
    operationalMetadata: text("operationalMetadata"),
    originalFileName: varchar("originalFileName", { length: 255 }),
    colorVerified: boolean("colorVerified").default(false).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("media_product_idx").on(table.productId), index("media_variant_idx").on(table.variantId)],
);

/**
 * Audit trail for derived operational media only. This table intentionally keeps
 * no OneDrive URL, OAuth token, or storage key after a reference is released.
 */
export const productMediaLifecycleEvents = mysqlTable(
  "product_media_lifecycle_events",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("productId").notNull(),
    mediaId: int("mediaId").notNull(),
    action: mysqlEnum("action", ["operational_copy_created", "operational_copy_regenerated", "reference_detached", "product_purged"]).notNull(),
    result: mysqlEnum("result", ["succeeded", "skipped"]).default("succeeded").notNull(),
    createdByUserId: int("createdByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("media_lifecycle_product_idx").on(table.productId), index("media_lifecycle_media_idx").on(table.mediaId)],
);

/**
 * Draft content remains separate from the product catalogue. A post may refer
 * to a product, but its added media never becomes product media by default.
 */
export const contentPosts = mysqlTable(
  "content_posts",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    productId: int("productId").references(() => products.id),
    status: mysqlEnum("status", ["draft", "needs_review", "approved", "changes_requested", "archived"]).default("draft").notNull(),
    title: varchar("title", { length: 200 }),
    contentType: mysqlEnum("contentType", ["feed_post", "story", "reel", "catalog", "other"]).default("feed_post").notNull(),
    channelPlan: mysqlEnum("channelPlan", ["general", "facebook", "instagram", "tiktok", "whatsapp"]).default("general").notNull(),
    plannedFor: timestamp("plannedFor"),
    caption: text("caption"),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    reviewedByUserId: int("reviewedByUserId").references(() => users.id),
    reviewedAt: timestamp("reviewedAt"),
    reviewNote: text("reviewNote"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("content_post_store_idx").on(table.storeId),
    index("content_post_product_idx").on(table.productId),
    index("content_post_creator_idx").on(table.createdByUserId),
    index("content_post_store_status_idx").on(table.storeId, table.status),
    index("content_post_store_planned_idx").on(table.storeId, table.plannedFor),
  ],
);

/**
 * Manually added post media points to its own storage key. A product reference
 * is created only after an explicit, separately authorized attach action.
 */
export const contentPostMedia = mysqlTable(
  "content_post_media",
  {
    id: int("id").autoincrement().primaryKey(),
    postId: int("postId").notNull().references(() => contentPosts.id),
    storageKey: varchar("storageKey", { length: 512 }).notNull(),
    originalFileName: varchar("originalFileName", { length: 255 }).notNull(),
    mimeType: varchar("mimeType", { length: 120 }).notNull(),
    byteSize: int("byteSize").notNull(),
    linkedProductMediaId: int("linkedProductMediaId").references(() => productMedia.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("content_post_media_post_idx").on(table.postId), index("content_post_media_product_media_idx").on(table.linkedProductMediaId)],
);

/** Append-only collaboration history for a content draft. */
export const contentPostActivities = mysqlTable(
  "content_post_activities",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    postId: int("postId").notNull().references(() => contentPosts.id),
    actorUserId: int("actorUserId").references(() => users.id),
    action: mysqlEnum("action", ["created", "updated", "review_requested", "approved", "changes_requested", "archived"]).notNull(),
    note: text("note"),
    metadata: text("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("content_activity_store_idx").on(table.storeId), index("content_activity_post_idx").on(table.postId), index("content_activity_post_time_idx").on(table.postId, table.createdAt)],
);

/** Internal marketing plans. Approval is never a permission to buy, publish, or send externally. */
export const marketingCampaigns = mysqlTable(
  "marketing_campaigns",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    name: varchar("name", { length: 180 }).notNull(),
    objective: mysqlEnum("objective", ["product_launch", "reengagement", "promotion", "awareness", "other"]).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["draft", "needs_approval", "approved", "changes_requested", "archived"]).default("draft").notNull(),
    audienceType: mysqlEnum("audienceType", ["all_customers", "customer_tag", "relationship_stage"]).default("all_customers").notNull(),
    audienceTagId: int("audienceTagId").references(() => customerTags.id),
    audienceStage: mysqlEnum("audienceStage", ["new", "active", "repeat", "needs_followup", "inactive"]),
    budgetAmount: decimal("budgetAmount", { precision: 12, scale: 2 }).default("0.00").notNull(),
    budgetCurrency: varchar("budgetCurrency", { length: 12 }).default("IQD").notNull(),
    approvalNote: text("approvalNote"),
    approvedByUserId: int("approvedByUserId").references(() => users.id),
    approvedAt: timestamp("approvedAt"),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    index("marketing_campaign_store_status_idx").on(table.storeId, table.status),
    index("marketing_campaign_store_created_idx").on(table.storeId, table.createdAt),
    index("marketing_campaign_tag_idx").on(table.audienceTagId),
  ],
);

/** Explicit campaign-to-approved-content linkage. */
export const marketingCampaignContent = mysqlTable(
  "marketing_campaign_content",
  {
    id: int("id").autoincrement().primaryKey(),
    campaignId: int("campaignId").notNull().references(() => marketingCampaigns.id),
    contentPostId: int("contentPostId").notNull().references(() => contentPosts.id),
    linkedByUserId: int("linkedByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [uniqueIndex("marketing_campaign_content_unique").on(table.campaignId, table.contentPostId), index("marketing_campaign_content_post_idx").on(table.contentPostId)],
);

/** Planned amounts only. Actual spend belongs to a future verified ads integration. */
export const marketingCampaignBudgetItems = mysqlTable(
  "marketing_campaign_budget_items",
  {
    id: int("id").autoincrement().primaryKey(),
    campaignId: int("campaignId").notNull().references(() => marketingCampaigns.id),
    name: varchar("name", { length: 180 }).notNull(),
    description: text("description"),
    unitPrice: decimal("unitPrice", { precision: 12, scale: 2 }).notNull(),
    quantity: int("quantity").default(1).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("marketing_budget_campaign_idx").on(table.campaignId)],
);

/** Append-only audit-friendly history for an internal marketing campaign. */
export const marketingCampaignActivities = mysqlTable(
  "marketing_campaign_activities",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    campaignId: int("campaignId").notNull().references(() => marketingCampaigns.id),
    actorUserId: int("actorUserId").references(() => users.id),
    action: mysqlEnum("action", ["created", "updated", "content_linked", "content_unlinked", "budget_updated", "approval_requested", "approved", "changes_requested", "archived"]).notNull(),
    note: text("note"),
    metadata: text("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("marketing_activity_store_idx").on(table.storeId), index("marketing_activity_campaign_time_idx").on(table.campaignId, table.createdAt)],
);

/** One internal, store-scoped loyalty program. It has no monetary conversion in Loyalty-A. */
export const loyaltyPrograms = mysqlTable(
  "loyalty_programs",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    name: varchar("name", { length: 180 }).notNull(),
    pointsLabel: varchar("pointsLabel", { length: 80 }).default("نقطة").notNull(),
    status: mysqlEnum("status", ["draft", "active", "paused", "archived"]).default("draft").notNull(),
    description: text("description"),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    activatedByUserId: int("activatedByUserId").references(() => users.id),
    activatedAt: timestamp("activatedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("loyalty_program_store_unique").on(table.storeId), index("loyalty_program_store_status_idx").on(table.storeId, table.status)],
);

/** Informational store-local tiers. Loyalty-A never assigns a tier automatically. */
export const loyaltyTiers = mysqlTable(
  "loyalty_tiers",
  {
    id: int("id").autoincrement().primaryKey(),
    programId: int("programId").notNull().references(() => loyaltyPrograms.id),
    name: varchar("name", { length: 120 }).notNull(),
    rank: int("rank").notNull(),
    thresholdPoints: int("thresholdPoints").default(0).notNull(),
    benefitsSummary: text("benefitsSummary"),
    isBase: boolean("isBase").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("loyalty_tier_program_rank_unique").on(table.programId, table.rank), uniqueIndex("loyalty_tier_program_name_unique").on(table.programId, table.name), index("loyalty_tier_program_idx").on(table.programId)],
);

/** A membership joins an existing CRM customer to a single program in the same store. */
export const loyaltyMemberships = mysqlTable(
  "loyalty_memberships",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    programId: int("programId").notNull().references(() => loyaltyPrograms.id),
    customerId: int("customerId").notNull().references(() => customerProfiles.id),
    currentTierId: int("currentTierId").references(() => loyaltyTiers.id),
    pointsBalance: int("pointsBalance").default(0).notNull(),
    status: mysqlEnum("status", ["active", "paused", "removed"]).default("active").notNull(),
    joinedAt: timestamp("joinedAt").defaultNow().notNull(),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("loyalty_membership_program_customer_unique").on(table.programId, table.customerId), index("loyalty_membership_store_status_idx").on(table.storeId, table.status), index("loyalty_membership_customer_idx").on(table.customerId)],
);

/** A reviewable, non-redeemable promise. Approval never creates a coupon, discount, or order mutation. */
export const loyaltyRewards = mysqlTable(
  "loyalty_rewards",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    programId: int("programId").notNull().references(() => loyaltyPrograms.id),
    membershipId: int("membershipId").notNull().references(() => loyaltyMemberships.id),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description"),
    status: mysqlEnum("status", ["draft", "needs_approval", "approved", "archived"]).default("draft").notNull(),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    approvedByUserId: int("approvedByUserId").references(() => users.id),
    approvedAt: timestamp("approvedAt"),
    decisionNote: text("decisionNote"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("loyalty_reward_store_status_idx").on(table.storeId, table.status), index("loyalty_reward_membership_idx").on(table.membershipId)],
);

/** Immutable balance movement. A balance can only change through one of these records. */
export const loyaltyPointLedger = mysqlTable(
  "loyalty_point_ledger",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    programId: int("programId").notNull().references(() => loyaltyPrograms.id),
    membershipId: int("membershipId").notNull().references(() => loyaltyMemberships.id),
    direction: mysqlEnum("direction", ["credit", "debit"]).notNull(),
    pointsDelta: int("pointsDelta").notNull(),
    balanceAfter: int("balanceAfter").notNull(),
    reason: mysqlEnum("reason", ["manual_award", "manual_deduction", "correction"]).notNull(),
    note: text("note").notNull(),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("loyalty_ledger_store_time_idx").on(table.storeId, table.createdAt), index("loyalty_ledger_membership_time_idx").on(table.membershipId, table.createdAt)],
);

/** Append-only operational history distinct from the points source-of-truth ledger. */
export const loyaltyActivities = mysqlTable(
  "loyalty_activities",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    programId: int("programId").notNull().references(() => loyaltyPrograms.id),
    membershipId: int("membershipId").references(() => loyaltyMemberships.id),
    rewardId: int("rewardId").references(() => loyaltyRewards.id),
    ledgerEntryId: int("ledgerEntryId").references(() => loyaltyPointLedger.id),
    type: mysqlEnum("type", ["program_created", "program_status_changed", "tier_created", "membership_joined", "membership_status_changed", "tier_assigned", "points_recorded", "reward_created", "reward_approval_requested", "reward_approved", "reward_archived"]).notNull(),
    note: text("note"),
    actorUserId: int("actorUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("loyalty_activity_store_time_idx").on(table.storeId, table.createdAt), index("loyalty_activity_program_time_idx").on(table.programId, table.createdAt), index("loyalty_activity_membership_idx").on(table.membershipId)],
);

/** A private, in-app notification. It only points to operational work and never carries channel delivery state. */
export const workNotifications = mysqlTable(
  "work_notifications",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    recipientUserId: int("recipientUserId").notNull().references(() => users.id),
    type: mysqlEnum("type", ["inbox_assigned", "bot_handoff", "crm_task_assigned", "content_review_requested", "marketing_approval_requested", "loyalty_reward_review_requested", "order_created"]).notNull(),
    priority: mysqlEnum("priority", ["info", "action", "urgent"]).default("info").notNull(),
    title: varchar("title", { length: 220 }).notNull(),
    body: text("body"),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: int("entityId").notNull(),
    route: varchar("route", { length: 500 }).notNull(),
    dedupeKey: varchar("dedupeKey", { length: 160 }),
    readAt: timestamp("readAt"),
    archivedAt: timestamp("archivedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("notification_store_user_dedupe_unique").on(table.storeId, table.recipientUserId, table.dedupeKey),
    index("notification_recipient_inbox_idx").on(table.storeId, table.recipientUserId, table.archivedAt, table.readAt, table.createdAt),
    index("notification_entity_idx").on(table.storeId, table.entityType, table.entityId),
  ],
);

/** Per-user display preferences for the internal notification centre. There are no delivery-channel preferences in Notifications-A. */
export const notificationPreferences = mysqlTable(
  "notification_preferences",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    userId: int("userId").notNull().references(() => users.id),
    inboxAssignments: boolean("inboxAssignments").default(true).notNull(),
    botHandoffs: boolean("botHandoffs").default(true).notNull(),
    crmTasks: boolean("crmTasks").default(true).notNull(),
    reviewRequests: boolean("reviewRequests").default(true).notNull(),
    orderUpdates: boolean("orderUpdates").default(true).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("notification_preferences_store_user_unique").on(table.storeId, table.userId)],
);

export const productImportJobs = mysqlTable(
  "product_import_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    source: mysqlEnum("source", ["onedrive", "manual"]).notNull(),
    sourceReference: varchar("sourceReference", { length: 512 }),
    status: mysqlEnum("status", ["pending", "processing", "needs_review", "completed", "failed"]).default("pending").notNull(),
    linkedProductId: int("linkedProductId").references(() => products.id),
    missingFields: text("missingFields"),
    errorSummary: text("errorSummary"),
    createdByUserId: int("createdByUserId").references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("import_job_store_status_idx").on(table.storeId, table.status), index("import_job_status_idx").on(table.status), index("import_job_product_idx").on(table.linkedProductId)],
);

/** One background Catalog scan configuration per owner connection. */
export const catalogSyncSettings = mysqlTable(
  "catalog_sync_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    ownerUserId: int("ownerUserId").notNull().references(() => users.id),
    scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
    cronExpression: varchar("cronExpression", { length: 80 }).default("0 */10 * * * *").notNull(),
    isEnabled: boolean("isEnabled").default(true).notNull(),
    lastStartedAt: timestamp("lastStartedAt"),
    lastCompletedAt: timestamp("lastCompletedAt"),
    isRunning: boolean("isRunning").default(false).notNull(),
    lastRunStage: varchar("lastRunStage", { length: 80 }),
    lastRunProcessedFolders: int("lastRunProcessedFolders").default(0).notNull(),
    lastRunTotalFolders: int("lastRunTotalFolders").default(0).notNull(),
    lastRunCurrentProduct: varchar("lastRunCurrentProduct", { length: 180 }),
    lastRunDurationMs: int("lastRunDurationMs"),
    lastRunUpdatedAt: timestamp("lastRunUpdatedAt"),
    lastSummary: text("lastSummary"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("catalog_sync_store_unique").on(table.storeId), index("catalog_sync_owner_idx").on(table.ownerUserId), index("catalog_sync_enabled_idx").on(table.isEnabled)],
);

/** A durable read-only observation of every Catalog product folder. */
export const catalogFolderImports = mysqlTable(
  "catalog_folder_imports",
  {
    id: int("id").autoincrement().primaryKey(),
    storeId: int("storeId").notNull().references(() => stores.id),
    ownerUserId: int("ownerUserId").notNull().references(() => users.id),
    productFolderId: varchar("productFolderId", { length: 255 }).notNull(),
    groupName: varchar("groupName", { length: 120 }).notNull(),
    productCode: varchar("productCode", { length: 80 }).notNull(),
    sourceReference: varchar("sourceReference", { length: 512 }).notNull(),
    state: mysqlEnum("state", ["discovered", "draft_created", "already_exists", "needs_review", "failed"]).notNull(),
    linkedProductId: int("linkedProductId").references(() => products.id),
    missingFields: text("missingFields"),
    imageCount: int("imageCount").default(0).notNull(),
    lastError: text("lastError"),
    lastScannedAt: timestamp("lastScannedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("catalog_folder_store_unique").on(table.storeId, table.productFolderId),
    index("catalog_folder_owner_idx").on(table.ownerUserId),
    index("catalog_folder_state_idx").on(table.state),
    index("catalog_folder_product_idx").on(table.linkedProductId),
  ],
);

/** Unified audit trail for UI, background, and future WhatsApp product changes. */
export const productOperations = mysqlTable(
  "product_operations",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("productId").notNull().references(() => products.id),
    actorUserId: int("actorUserId").references(() => users.id),
    source: mysqlEnum("source", ["catalog_scan", "products_ui", "whatsapp"]).notNull(),
    action: varchar("action", { length: 80 }).notNull(),
    changes: text("changes").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("product_operations_product_idx").on(table.productId), index("product_operations_source_idx").on(table.source)],
);

export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductImportJob = typeof productImportJobs.$inferSelect;
export type CatalogSyncSetting = typeof catalogSyncSettings.$inferSelect;
export type CatalogFolderImport = typeof catalogFolderImports.$inferSelect;
export type ProductOperation = typeof productOperations.$inferSelect;
export type ProductMediaLifecycleEvent = typeof productMediaLifecycleEvents.$inferSelect;
export type ContentPost = typeof contentPosts.$inferSelect;
export type ContentPostMedia = typeof contentPostMedia.$inferSelect;

export const oneDriveOAuthStates = mysqlTable(
  "onedrive_oauth_states",
  {
    id: int("id").autoincrement().primaryKey(),
    state: varchar("state", { length: 160 }).notNull().unique(),
    userId: int("userId").notNull().references(() => users.id),
    codeVerifier: varchar("codeVerifier", { length: 160 }).notNull(),
    flow: mysqlEnum("flow", ["app_folder", "catalog_read"]).default("app_folder").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("onedrive_oauth_state_user_idx").on(table.userId)],
);

export const oneDriveConnections = mysqlTable(
  "onedrive_connections",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().unique().references(() => users.id),
    encryptedAccessToken: text("encryptedAccessToken").notNull(),
    encryptedRefreshToken: text("encryptedRefreshToken").notNull(),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt").notNull(),
    appFolderId: varchar("appFolderId", { length: 255 }).notNull(),
    appFolderUrl: text("appFolderUrl"),
    scope: text("scope"),
    connectedAt: timestamp("connectedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("onedrive_connection_folder_idx").on(table.appFolderId)],
);

/**
 * Separate delegated connection for the owner-approved Catalog selection test.
 * Tokens are encrypted; the selected reference is stored independently from the
 * least-privilege App Folder connection so one flow cannot be mistaken for the other.
 */
export const oneDriveCatalogConnections = mysqlTable(
  "onedrive_catalog_connections",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().unique().references(() => users.id),
    encryptedAccessToken: text("encryptedAccessToken").notNull(),
    encryptedRefreshToken: text("encryptedRefreshToken").notNull(),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt").notNull(),
    scope: text("scope").notNull(),
    status: mysqlEnum("status", ["connected", "failed", "catalog_selected"]).default("connected").notNull(),
    lastError: text("lastError"),
    selectedDriveId: varchar("selectedDriveId", { length: 255 }),
    selectedFolderId: varchar("selectedFolderId", { length: 255 }),
    selectedFolderName: varchar("selectedFolderName", { length: 255 }),
    connectedAt: timestamp("connectedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("onedrive_catalog_connection_status_idx").on(table.status)],
);
