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

  it("يظهر OneDrive والمعاينة الانتقائية مباشرة مع إبقاء Meta قابلًا للفتح", () => {
    const source = readFileSync(resolve(process.cwd(), "client/src/pages/Products.tsx"), "utf8");
    expect(source).toContain("const [oneDrivePanelOpen, setOneDrivePanelOpen] = useState(true)");
    expect(source).toContain("const [metaCatalogPanelOpen, setMetaCatalogPanelOpen] = useState(false)");
    expect(source).toContain(">OneDrive<");
    expect(source).toContain(">Meta Catalog<");
    expect(source).toContain("{oneDrivePanelOpen &&");
    expect(source).toContain("{metaCatalogPanelOpen &&");
  });
});
