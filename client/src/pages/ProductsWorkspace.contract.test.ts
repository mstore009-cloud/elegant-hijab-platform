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

  it("يعرض مصفوفة اللون والقياس ويحفظ كل متغير عبر saveInventory", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("مصفوفة المخزون: اللون × القياس");
    expect(source).toContain("trpc.products.saveInventory.useMutation");
    expect(source).toContain("حفظ مخزون المتغيرات");
    expect(source).toContain("inventoryDrafts[variant.id]");
    expect(source).toContain("inventoryStatusLabel");
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
});
