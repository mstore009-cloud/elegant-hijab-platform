import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductListThumbnail } from "./ProductListThumbnail";

describe("مصغرة صف قائمة المنتج", () => {
  it("ترسم صورة تشغيلية عندما يتوفر رابطها وترسم الحالة البديلة عندما يغيب", () => {
    const withImage = renderToStaticMarkup(<ProductListThumbnail imageUrl="https://media.example/product.webp" alt="صورة حجاب" />);
    expect(withImage).toContain('<img');
    expect(withImage).toContain('src="https://media.example/product.webp"');

    const withoutImage = renderToStaticMarkup(<ProductListThumbnail imageUrl={null} alt="صورة غير متاحة" />);
    expect(withoutImage).toContain("لا صورة");
    expect(withoutImage).not.toContain("<img");
  });
});
