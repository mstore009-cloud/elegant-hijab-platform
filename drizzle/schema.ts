import { boolean, decimal, index, int, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

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
    originalFileName: varchar("originalFileName", { length: 255 }),
    colorVerified: boolean("colorVerified").default(false).notNull(),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("media_product_idx").on(table.productId), index("media_variant_idx").on(table.variantId)],
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

export type Product = typeof products.$inferSelect;
export type ProductVariant = typeof productVariants.$inferSelect;
export type ProductImportJob = typeof productImportJobs.$inferSelect;

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
