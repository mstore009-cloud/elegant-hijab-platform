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
 * Operational staff profile. Authentication stays on `users`; this table holds
 * the business identity that receives granular permissions.
 */
export const employeeProfiles = mysqlTable("employee_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique().references(() => users.id),
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
    productCode: varchar("productCode", { length: 80 }).notNull().unique(),
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
  table => [index("product_status_idx").on(table.status), index("product_category_idx").on(table.category)],
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

/** Customer request created from the public store or future staff/WhatsApp channels. */
export const orders = mysqlTable(
  "orders",
  {
    id: int("id").autoincrement().primaryKey(),
    orderNumber: varchar("orderNumber", { length: 40 }).notNull().unique(),
    status: mysqlEnum("status", orderStatuses).default("new").notNull(),
    source: mysqlEnum("source", ["storefront", "manual", "whatsapp"]).default("storefront").notNull(),
    customerChannel: mysqlEnum("customerChannel", ["storefront", "whatsapp", "instagram", "messenger", "manual"]).default("storefront").notNull(),
    customerName: varchar("customerName", { length: 160 }).notNull(),
    customerPhone: varchar("customerPhone", { length: 40 }).notNull(),
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
  table => [index("orders_status_idx").on(table.status), index("orders_phone_idx").on(table.customerPhone), index("orders_created_idx").on(table.createdAt)],
);

/** Delivery fee configured by staff; a carrier integration can replace this source later. */
export const deliveryGovernorateRates = mysqlTable(
  "delivery_governorate_rates",
  {
    id: int("id").autoincrement().primaryKey(),
    governorate: varchar("governorate", { length: 120 }).notNull().unique(),
    fee: decimal("fee", { precision: 12, scale: 2 }).default("0.00").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    updatedByUserId: int("updatedByUserId").references(() => users.id),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("delivery_governorate_rates_enabled_idx").on(table.enabled)],
);

/** Singleton-style operating settings for the public store. */
export const storeSettings = mysqlTable(
  "store_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    defaultLanguage: varchar("defaultLanguage", { length: 16 }).default("ar").notNull(),
    currencyCode: varchar("currencyCode", { length: 8 }).default("IQD").notNull(),
    updatedByUserId: int("updatedByUserId").references(() => users.id),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
);

export const promotionCoupons = mysqlTable(
  "promotion_coupons",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 80 }).notNull().unique(),
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
  table => [index("promotion_coupons_enabled_idx").on(table.enabled)],
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
    productId: int("productId").references(() => products.id),
    status: mysqlEnum("status", ["draft"]).default("draft").notNull(),
    caption: text("caption"),
    createdByUserId: int("createdByUserId").notNull().references(() => users.id),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("content_post_product_idx").on(table.productId), index("content_post_creator_idx").on(table.createdByUserId)],
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

export const productImportJobs = mysqlTable(
  "product_import_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
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
  table => [index("import_job_status_idx").on(table.status), index("import_job_product_idx").on(table.linkedProductId)],
);

/** One background Catalog scan configuration per owner connection. */
export const catalogSyncSettings = mysqlTable(
  "catalog_sync_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("ownerUserId").notNull().unique().references(() => users.id),
    scheduleCronTaskUid: varchar("scheduleCronTaskUid", { length: 65 }),
    cronExpression: varchar("cronExpression", { length: 80 }).default("0 */10 * * * *").notNull(),
    isEnabled: boolean("isEnabled").default(true).notNull(),
    lastStartedAt: timestamp("lastStartedAt"),
    lastCompletedAt: timestamp("lastCompletedAt"),
    lastSummary: text("lastSummary"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("catalog_sync_enabled_idx").on(table.isEnabled)],
);

/** A durable read-only observation of every Catalog product folder. */
export const catalogFolderImports = mysqlTable(
  "catalog_folder_imports",
  {
    id: int("id").autoincrement().primaryKey(),
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
    uniqueIndex("catalog_folder_owner_unique").on(table.ownerUserId, table.productFolderId),
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
