import { beforeEach, describe, expect, it, vi } from "vitest";

const { extractRawText } = vi.hoisted(() => ({ extractRawText: vi.fn() }));
vi.mock("mammoth", () => ({ default: { extractRawText } }));

import { parseCatalogProductMetadataDocx, parseCatalogProductMetadataLenientDocx, parseCatalogProductMetadata } from "./productMetadata";

describe("محلل product.docx المكافئ لقالب product.txt", () => {
  const content = `PRODUCT_NAME_AR: حجاب Word
SELLING_PRICE_IQD: 12000
PREVIOUS_PRICE_IQD: 15000
DESCRIPTION_AR: وصف من ملف Word
SIZES: Medium, Large
PRODUCT_STATUS: draft`;

  beforeEach(() => extractRawText.mockReset());

  it("يستخرج الحقول نفسها التي يستخرجها product.txt", async () => {
    extractRawText.mockResolvedValue({ value: content });
    const fromWord = await parseCatalogProductMetadataDocx(Buffer.from("docx-fixture"));
    const fromText = parseCatalogProductMetadata(content);
    expect(fromWord).toEqual(fromText);
    expect(extractRawText).toHaveBeenCalledWith({ buffer: expect.any(Buffer) });
  });

  it("يحافظ على مسار المسودة المرن عند نقص حقل في Word", async () => {
    extractRawText.mockResolvedValue({ value: "PRODUCT_NAME_AR: حجاب Word\nSELLING_PRICE_IQD: 12000\nSIZES:" });
    await expect(parseCatalogProductMetadataLenientDocx(Buffer.from("docx-fixture"))).resolves.toMatchObject({
      name: "حجاب Word",
      sellingPrice: "12000",
      sizes: [],
      problems: ["description"],
    });
  });

  it("يرفض ملف Word الفارغ قبل استدعاء المحول", async () => {
    await expect(parseCatalogProductMetadataDocx(Buffer.alloc(0))).rejects.toThrow("ملف Word فارغ");
    expect(extractRawText).not.toHaveBeenCalled();
  });
});
