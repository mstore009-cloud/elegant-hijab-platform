import React from "react";

type ProductListThumbnailProps = {
  imageUrl: string | null;
  alt: string;
  className?: string;
};

export function ProductListThumbnail({ imageUrl, alt, className = "h-12 w-10" }: ProductListThumbnailProps) {
  return (
    <div className={`${className} shrink-0 overflow-hidden rounded-lg border border-[#d8e7df] bg-[#edf5f1]`}>
      {imageUrl ? (
        <img src={imageUrl} alt={alt} className="h-full w-full object-contain" loading="lazy" />
      ) : (
        <span className="grid h-full w-full place-items-center text-[10px] text-[#6d8277]">لا صورة</span>
      )}
    </div>
  );
}
