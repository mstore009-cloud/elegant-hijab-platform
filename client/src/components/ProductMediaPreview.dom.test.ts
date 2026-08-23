import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductMediaPreview } from "./ProductMediaPreview";

describe("معرض مصغرات المنتج", () => {
  it("يرسم عنصر img وبيانات اللون والملف لكل مرجع وسائط", () => {
    const markup = renderToStaticMarkup(createElement(ProductMediaPreview, {
      media: [
        { mediaId: 1, colorName: "عنابي", originalFileName: "burgundy.png", dataUrl: "data:image/png;base64,AAAA" },
        { mediaId: 2, colorName: "زيتي", originalFileName: "olive.jpg", dataUrl: "data:image/jpeg;base64,BBBB" },
      ],
    }));

    expect(markup).toContain('data-testid="product-media-preview"');
    expect((markup.match(/<img /g) ?? []).length).toBe(2);
    expect(markup).toContain('src="data:image/png;base64,AAAA"');
    expect(markup).toContain('alt="صورة عنابي"');
    expect(markup).toContain("burgundy.png");
    expect(markup).toContain('alt="صورة زيتي"');
    expect(markup).toContain("olive.jpg");
  });
});
