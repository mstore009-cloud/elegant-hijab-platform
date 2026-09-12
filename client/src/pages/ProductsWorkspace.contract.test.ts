import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("واجهة المنتجات النشطة ومسودات العمل", () => {
  it("تجعل المنتجات النشطة هي المسار الافتراضي وتفصل مساحة المسودات", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain('useState<ProductSurface>("active")');
    expect(source).toContain('surface === "active" ? product.status === "active"');
    expect(source).toContain('!["active", "archived"].includes(product.status)');
    expect(source).toContain(">النشطة ");
    expect(source).toContain(">المسودات ");
  });

  it("يبقي OneDrive والمعاينة التقنية خارج المسار اليومي مع إبقاء Meta قابلًا للفتح", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("const [oneDrivePanelOpen, setOneDrivePanelOpen] = useState(false)");
    expect(source).toContain("const [metaCatalogPanelOpen, setMetaCatalogPanelOpen] = useState(false)");
    expect(source).toContain(">OneDrive<");
    expect(source).toContain(">Meta Catalog<");
    expect(source).toContain("{oneDrivePanelOpen &&");
    expect(source).toContain("{metaCatalogPanelOpen &&");
  });

  it("يظهر الإدخال اليدوي ويستخدم قرار المسودة أو التنشيط فقط", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("trpc.products.create.useMutation");
    expect(source).toContain("إضافة منتج يدويًا");
    expect(source).toContain("حفظ كمسودة");
    expect(source).toContain("تنشيط وتفعيل");
    expect(source).toContain('status: "draft"');
  });

  it("يعرض مصفوفة اللون والقياس ويحفظ كل متغير عبر saveInventory عند وجود قياسات", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("مصفوفة المخزون: اللون × القياس");
    expect(source).toContain("(detail.product.sizeLabels ?? []).length > 0");
    expect(source).toContain("function ColorCard({ colorName, quantity, media, variants, sizeLabels, onOpen }");
    expect(source).toContain("const hasSizes = sizeLabels.length > 0");
    expect(source).toContain("مخزون ${colorName} حسب القياس");
    expect(source).toContain("{hasSizes && <div className=\"mt-3 grid grid-cols-2 gap-2\"");
    expect(source).toContain('const sizeStatus = sizeQuantity <= 0 ? "out_of_stock" : sizeQuantity <= 3 ? "low_stock" : "available"');
    expect(source).toContain("inventoryStatusLabel(sizeStatus)");
    expect(source).toContain("inventoryStatusClass(sizeStatus)");
    expect(source).toContain('bg-[#2f9e62]');
    expect(source).toContain('bg-[#d99528]');
    expect(source).toContain('bg-[#d35445]');
    expect(source).toContain("productSizes");
    expect(source).toContain("trpc.products.saveInventory.useMutation");
    expect(source).toContain("حفظ مخزون المتغيرات");
    expect(source).toContain("inventoryDrafts[variant.id]");
    expect(source).toContain("inventoryStatusLabel");
  });

  it("لا يعرض أي اعتبار للقياس عندما لا توجد قياسات للمنتج", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("{productSizes.length > 0 && <p><span className=\"text-[#74817a]\">القياسات:");
    expect(source).toContain("sizeLabels={productSizes}");
    expect(source).toContain("{hasSizes ? \"إجمالي القطع\" : \"قطعة\"}");
  });

  it("يعرض الأرشيف ومؤشر اكتمال وملخص المتغيرات", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain('surface === "archived"');
    expect(source).toContain(">الأرشيف ");
    expect(source).toContain("trpc.products.archive.useMutation");
    expect(source).toContain("trpc.products.restoreFromArchive.useMutation");
    expect(source).toContain("استعادة كمسودة</button>");
    expect(source).toContain("left-4 top-4 z-20");
    expect(source).toContain("اعتماد المنتج");
    expect(source).toContain("جارٍ الاعتماد...");
    expect(source).toContain("activateProduct.mutate({ productId: detail.product.id })");
    expect(source).toContain("activateProduct.mutate({ productId: product.id })");
    expect(source).toContain("left-24 top-4 z-10");
    expect(source).toContain("productCompletion(product)");
    expect(source).toContain("اكتمال المنتج");
    expect(source).toContain("متغير");
  });

  it("يتيح اعتماد المسودات المكتملة جماعيًا ويعيدها إلى تبويب النشطة مع إشعار", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("trpc.products.activateMany.useMutation");
    expect(source).toContain("selectedReadyProductIds");
    expect(source).toContain("تحديد المكتمل");
    expect(source).toContain("اعتماد المحدد");
    expect(source).toContain("تم اعتماد");
    expect(source).toContain('setSurface("active")');
    expect(source).toContain("role=\"status\"");
  });

  it("لا يعرض اعتماد المنتج إلا بعد فحص الجاهزية ويعرض إكمال المنتج للناقص", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("isReadyForActivation");
    expect(source).toContain("أكمل المنتج");
    expect(source).toContain("openProductCompletion(product.id, product.readinessReasons?.[0])");
    expect(source).toContain("scrollIntoView({ behavior: \"smooth\", block: \"start\" })");
  });

  it("يوفر فرزًا تشغيليًا حسب آخر تعديل والنواقص والمخزون", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain('type ProductSort = "updated" | "missing" | "inventory"');
    expect(source).toContain('id="product-sort"');
    expect(source).toContain("الأحدث تعديلًا");
    expect(source).toContain("الأكثر نقصًا");
    expect(source).toContain("الأقل مخزونًا");
    expect(source).toContain("productLastActivity");
    expect(source).toContain("sortedProducts");
  });

  it("يعرض بطاقة آخر حركة موحدة للمنتج", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("function productActivity");
    expect(source).toContain("آخر حركة");
    expect(source).toContain("productActivity(product)");
    expect(source).toContain("تعديل السعر");
  });

  it("يعرض مركز عمل تفاعليًا بدل أشرطة الفلاتر المتداخلة ويخفيه عن الأرشيف", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain('type WorkView = "all" | "completion" | "low_stock" | "out_of_stock" | "media_review" | "color_review" | "meta_sync" | "meta_stale"');
    expect(source).toContain("operationalMissingFlags");
    expect(source).toContain("تنبيهات المنتجات");
    expect(source).toContain("مركز العمل");
    expect(source).toContain("مخزون منخفض");
    expect(source).toContain('surface !== "archived"');
    expect(source).toContain("workViewCounts.metaStale");
    expect(source).toContain("النتائج أدناه تخص هذا التنبيه فقط");
    expect(source).toContain("const workProducts = (products.data ?? []).filter(product => product.status !== \"archived\")");
    expect(source).toContain("mediaReview: workProducts.filter(product => workViewMatches(product, \"media_review\")).length");
    expect(source).toContain("colorReview: workProducts.filter(product => workViewMatches(product, \"color_review\")).length");
    expect(source).toContain("function workViewMatches");
    expect(source).toContain("const workViewProducts = useMemo");
    expect(source).toContain("فتح الأول");
    expect(source).toContain("setWorkView(view)");
    expect(source).toContain("صور تحتاج ربطًا بلون");
    expect(source).toContain("reviewMediaPreviews");
    expect(source).toContain("assignUnlinkedMediaToColorMany");
    expect(source).toContain("generateAutomaticSuggestionsMany");
    expect(source).toContain("تحليل واستخراج الألوان تلقائيًا");
    expect(source).toContain("moveReviewProduct");
    expect(source).toContain("السابق");
    expect(source).toContain("التالي");
  });

  it("يدعم رفع وسائط إضافية من التفاصيل وربط الصور بلون قائم", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("addDetailMedia");
    expect(source).toContain("detail-upload-color");
    expect(source).toContain("اسحب الوسائط هنا أو اختر ملفات");
    expect(source).toContain("uploadManualMedia.mutateAsync");
    expect(source).toContain("assignMediaColor.mutateAsync");
    expect(source).toContain("فيديو MP4/WebM");
  });

  it("يوضح الحفظ كمسودة ويوجه إلى الحقل الناقص مع شريط حفظ ثابت", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("حفظ كمسودة");
    expect(source).toContain("لن يتغير وضع النشر");
    expect(source).toContain("الحفظ هنا لا ينشر المنتج");
    expect(source).toContain("data-completion-field=\"price\"");
    expect(source).toContain("data-completion-field=\"inventory\"");
    expect(source).toContain("readinessReasonLabel");
    expect(source).toContain("openProductCompletion(product.id, product.readinessReasons?.[0])");
  });

  it("يدعم القياسات الاختيارية ورفع الصور والفيديوهات مع تحليل اللون التلقائي", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("createPreviousPrice");
    expect(source).toContain("createSizes");
    expect(source).toContain("createMediaFiles");
    expect(source).toContain("sizeLabels: sizes");
    expect(source).toContain("uploadManualMedia.mutateAsync");
    expect(source).toContain("acceptCreateMedia");
    expect(source).toContain("video/mp4");
    expect(source).toContain("variants: []");
    expect(source).toContain("السعر السابق");
    expect(source).toContain("القياسات");
    expect(source).toContain("صور وفيديوهات المنتج");
    expect(source).not.toContain("createColorName");
    expect(source).not.toContain("createQuantity");
  });

  it("يعزل أزرار الحفظ عن الإرسال الضمني وانتشار النقر", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("event?.preventDefault(); event?.stopPropagation();");
    expect(source).toContain('type="button" onClick={saveDetails}');
    expect(source).toContain('type="button" onClick={saveInventoryMatrix}');
    expect(source).toContain("saveColorDetails(colorName, event)");
    expect(source).toContain("submitManualProduct();");
  });
});
