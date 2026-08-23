import React from "react";

type ProductListThumbnailProps = {
  imageUrl: string | null;
  alt: string;
};

export function ProductListThumbnail({ imageUrl, alt }: ProductListThumbnailProps) {
  return (
    <div className="h-12 w-10 shrink-0 overflow-hidden rounded-lg border border-[#d8e7df] bg-[#edf5f1]">
      {imageUrl ? (
        <img src={imageUrl} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <span className="grid h-full w-full place-items-center text-[10px] text-[#6d8277]">لا صورة</span>
      )}
    </div>
  );
}
