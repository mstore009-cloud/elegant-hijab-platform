import React from "react";

type ProductListThumbnailProps = {
  imageUrl: string | null;
  alt: string;
  className?: string;
  imageClassName?: string;
};

export function ProductListThumbnail({ imageUrl, alt, className = "h-12 w-10", imageClassName = "h-full w-full object-contain" }: ProductListThumbnailProps) {
  return (
    <div className={`${className} shrink-0 overflow-hidden rounded-lg border border-[#d8e7df] bg-transparent`}>
      {imageUrl ? (
        <img src={imageUrl} alt={alt} className={imageClassName} loading="lazy" />
      ) : (
        <span className="grid h-full w-full place-items-center text-[10px] text-[#6d8277]">لا صورة</span>
      )}
    </div>
  );
}
