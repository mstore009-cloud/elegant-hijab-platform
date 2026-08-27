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
  { code: "crm.view", group: "إدارة العملاء", label: "عرض ملفات العملاء وسجلهم" },
  { code: "crm.manage", group: "إدارة العملاء", label: "تعديل ملفات العملاء ووسومهم ومهامهم" },
  { code: "inbox.read", group: "البريد الوارد", label: "قراءة الرسائل" },
  { code: "inbox.reply", group: "البريد الوارد", label: "الرد على العملاء" },
  { code: "inbox.manage", group: "البريد الوارد", label: "إدارة التعيين والحالة والمتابعة" },
  { code: "inbox.takeover", group: "البريد الوارد", label: "التدخل بدل البوت" },
  { code: "bot.training.manage", group: "البريد الوارد", label: "تدريب البوت" },
  { code: "bot.manage", group: "المساعد الذكي", label: "إدارة إعدادات وحدود بوت العملاء" },
  { code: "bot.knowledge.approve", group: "المساعد الذكي", label: "اعتماد وأرشفة معرفة بوت العملاء" },
  { code: "employee_bot.use", group: "مساعد الموظفين", label: "إنشاء مسودات أوامر الموظفين" },
  { code: "employee_bot.review", group: "مساعد الموظفين", label: "مراجعة واعتماد أو رفض مسودات الأوامر" },
  { code: "employee_bot.manage", group: "مساعد الموظفين", label: "إدارة نماذج وحدود مساعد الموظفين" },
  { code: "content.view", group: "المحتوى", label: "عرض تقويم ومسودات المحتوى" },
  { code: "content.manage", group: "المحتوى", label: "إنشاء وتحرير وأرشفة مسودات المحتوى" },
  { code: "content.approve", group: "المحتوى", label: "مراجعة واعتماد مسودات المحتوى" },
  { code: "marketing.view", group: "التسويق", label: "عرض الحملات والجمهور والميزانية التخطيطية" },
  { code: "marketing.manage", group: "التسويق", label: "إنشاء وتحرير وأرشفة الحملات الداخلية" },
  { code: "marketing.approve", group: "التسويق", label: "اعتماد الحملات الداخلية أو طلب تعديلها" },
  { code: "analytics.view", group: "التحليلات", label: "مشاهدة التقارير التشغيلية" },
  { code: "notifications.view", group: "التنبيهات", label: "عرض مركز التنبيهات الداخلي" },
  { code: "notifications.manage", group: "التنبيهات", label: "إدارة قراءة وأرشفة وتفضيلات التنبيهات الشخصية" },
  { code: "loyalty.view", group: "الولاء", label: "عرض برنامج الولاء والأعضاء ودفتر النقاط" },
  { code: "loyalty.manage", group: "الولاء", label: "إدارة العضويات والمستويات وحركات النقاط والمكافآت" },
  { code: "loyalty.approve", group: "الولاء", label: "تفعيل برنامج الولاء واعتماد مكافآته الداخلية" },
  { code: "staff.manage", group: "الإدارة التشغيلية", label: "إدارة موظفي المتجر وصلاحياتهم" },
  { code: "settings.manage", group: "الإعدادات", label: "إدارة الإعدادات والتكاملات" },
  { code: "finance.view_sensitive", group: "البيانات الحساسة", label: "مشاهدة التكلفة والهامش وصافي الربح" },
  { code: "finance.manage_sensitive", group: "البيانات الحساسة", label: "تعديل تكلفة المنتج والهامش المستهدف" },
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
  const effectivePermissions = getEffectivePermissionSet(input);
  return effectivePermissions.has("finance.view_sensitive") || effectivePermissions.has("finance.manage_sensitive");
}

export function hasPermission(input: {
  isPlatformAdmin: boolean;
  grantedPermissionCodes: readonly string[];
  permissionCode: PermissionCode;
}) {
  return getEffectivePermissionSet(input).has(input.permissionCode);
}
