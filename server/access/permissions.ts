export const permissionCatalog = [
  { code: "products.create", group: "المنتجات", label: "إضافة منتج" },
  { code: "products.edit", group: "المنتجات", label: "تعديل بيانات المنتج" },
  { code: "products.inventory.update", group: "المنتجات", label: "تحديث المخزون" },
  { code: "products.delete", group: "المنتجات", label: "حذف منتج" },
  { code: "pricing.manage", group: "المنتجات", label: "إدارة العروض والتسعير" },
  { code: "orders.view", group: "الطلبات", label: "عرض قائمة الطلبات" },
  { code: "orders.confirm", group: "الطلبات", label: "تثبيت وتأكيد الطلبات" },
  { code: "orders.fulfill", group: "الطلبات", label: "تجهيز الطلبات" },
  { code: "orders.delivery.submit", group: "الطلبات", label: "رفع الطلب لشركة التوصيل" },
  { code: "orders.cancel", group: "الطلبات", label: "إلغاء الطلبات" },
  { code: "orders.returns.manage", group: "الطلبات", label: "إدارة المشاكل والإرجاع" },
  { code: "inbox.read", group: "البريد الوارد", label: "قراءة الرسائل" },
  { code: "inbox.reply", group: "البريد الوارد", label: "الرد على العملاء" },
  { code: "inbox.takeover", group: "البريد الوارد", label: "التدخل بدل البوت" },
  { code: "bot.training.manage", group: "البريد الوارد", label: "تدريب البوت" },
  { code: "marketing.manage", group: "التسويق", label: "إدارة التسويق والإعلانات" },
  { code: "analytics.view", group: "التحليلات", label: "مشاهدة التقارير التشغيلية" },
  { code: "settings.manage", group: "الإعدادات", label: "إدارة الإعدادات والتكاملات" },
  { code: "finance.view_sensitive", group: "البيانات الحساسة", label: "مشاهدة التكلفة والهامش وصافي الربح" },
] as const;

export type PermissionCode = (typeof permissionCatalog)[number]["code"];

export const permissionCodes = permissionCatalog.map(item => item.code) as PermissionCode[];

export function getEffectivePermissionSet(input: {
  isPlatformAdmin: boolean;
  grantedPermissionCodes: readonly string[];
}) {
  return new Set<string>(input.isPlatformAdmin ? permissionCodes : input.grantedPermissionCodes);
}

export function canViewSensitiveFinancialData(input: {
  isPlatformAdmin: boolean;
  grantedPermissionCodes: readonly string[];
}) {
  return getEffectivePermissionSet(input).has("finance.view_sensitive");
}

export function hasPermission(input: {
  isPlatformAdmin: boolean;
  grantedPermissionCodes: readonly string[];
  permissionCode: PermissionCode;
}) {
  return getEffectivePermissionSet(input).has(input.permissionCode);
}
