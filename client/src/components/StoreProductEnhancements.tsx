import { ShoppingBag, X } from "lucide-react";

export type SuggestedStoreProduct = {
  productCode: string;
  name: string;
  sellingPrice: string;
  primaryImageUrl?: string | null;
  defaultColorName?: string | null;
};

type Props = {
  products: SuggestedStoreProduct[];
  price: (value: string | number) => string;
  onOpen: (code: string) => void;
  onQuickAdd: (product: SuggestedStoreProduct) => void;
  cartCount: number;
  cartPulse: boolean;
  onOpenCart: () => void;
  added: boolean;
  onDismiss: () => void;
  onShowCart: () => void;
  freeMessage?: string;
  progress?: number;
  addedColorName?: string;
  addedImageUrl?: string | null;
};

export function StoreProductEnhancements({ products, price, onOpen, onQuickAdd, cartCount, cartPulse, onOpenCart, added, onDismiss, onShowCart, freeMessage, progress, addedColorName, addedImageUrl }: Props) {
  return <>
    <button onClick={onOpenCart} aria-label="فتح السلة" className={`fixed bottom-5 left-5 z-40 rounded-full bg-[#173f38] p-4 text-white shadow-xl transition-transform motion-reduce:transition-none ${cartPulse ? "scale-110" : "scale-100"}`}>
      <ShoppingBag className="h-5 w-5" /><span className="absolute -right-2 -top-2 rounded-full bg-[#a47d40] px-1.5 text-xs">{cartCount}</span>
    </button>
    {products.length > 0 && <section className="mx-auto max-w-6xl px-5 pb-12" data-testid="product-suggestions"><h2 className="mb-3 text-xl font-black">قد يعجبك أيضًا</h2><div className="flex gap-3 overflow-x-auto pb-2">{products.map(product => <article key={product.productCode} className="group w-36 shrink-0 overflow-hidden rounded-2xl border bg-white"><button onClick={() => onOpen(product.productCode)} className="block w-full text-right">{product.primaryImageUrl ? <img src={product.primaryImageUrl} alt={product.name} className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-[#ece8dd]" role="img" aria-label={`لا توجد صورة للمنتج ${product.name}`} />}<p className="truncate px-3 pt-2 text-sm font-bold">{product.name}</p><p className="px-3 py-1 text-xs text-[#285f4e]">{price(product.sellingPrice)}</p></button><button onClick={() => onQuickAdd(product)} className="m-2 w-[calc(100%-1rem)] rounded-lg bg-[#173f38] px-2 py-2 text-xs font-bold text-white">إضافة للسلة</button></article>)}</div></section>}
    {added && <div className="fixed inset-0 z-[70] grid place-items-center bg-[#173f38]/35 p-5" data-testid="added-overlay"><section className="w-full max-w-sm rounded-3xl bg-white p-5 text-center shadow-2xl"><button onClick={onDismiss} className="float-left text-[#68756e]" aria-label="إغلاق الإشعار"><X /></button><h2 className="pt-2 text-xl font-black">تمت إضافة اللون إلى السلة</h2>{addedColorName && <div className="mx-auto mt-4 flex w-fit items-center gap-3 rounded-2xl border border-[#e6dfd2] bg-[#fcfaf5] p-2 text-right"><div className="h-14 w-12 overflow-hidden rounded-xl bg-[#ece8dd]">{addedImageUrl ? <img src={addedImageUrl} alt={`لون ${addedColorName}`} className="h-full w-full object-cover" /> : null}</div><div><p className="text-xs text-[#68756e]">اللون المختار</p><p className="font-black">{addedColorName}</p></div></div>}{freeMessage && <><p className="mt-2 text-sm text-[#285f4e]">{freeMessage}</p><div aria-label="شريط تقدم التوصيل المجاني في إشعار الإضافة" className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#d7eadf]"><div className="h-full bg-[#285f4e] transition-[width] duration-300" style={{ width: `${progress ?? 0}%` }} /></div><p className="mt-1 text-xs font-bold text-[#547065]">{Math.round(progress ?? 0)}% من هدف التوصيل المجاني</p></>}<div className="mt-5 flex gap-2"><button onClick={onShowCart} className="flex-1 rounded-xl bg-[#173f38] py-2.5 font-bold text-white">عرض السلة</button><button onClick={onDismiss} className="flex-1 rounded-xl border py-2.5 font-bold">متابعة التسوق</button></div></section></div>}
  </>;
}
