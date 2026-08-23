import React from "react";

export type ProductMediaPreviewItem = {
  mediaId: number;
  colorName: string;
  inventoryQuantity: number;
  originalFileName: string;
  dataUrl: string;
};

export function ProductMediaPreview({ media }: { media: ProductMediaPreviewItem[] }) {
  if (media.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="product-media-preview">
      {media.map(item => (
        <figure key={item.mediaId} className="overflow-hidden rounded-xl border border-[#d8e7df] bg-white">
          <img src={item.dataUrl} alt={`صورة ${item.colorName}`} className="aspect-[3/4] w-full object-cover" />
          <figcaption className="p-2 text-xs text-[#405c50]"><b>{item.colorName}</b><br />الكمية: {item.inventoryQuantity}</figcaption>
        </figure>
      ))}
    </div>
  );
}
