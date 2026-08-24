import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { ImagePlus, Link2, NotebookPen, Plus, UploadCloud } from "lucide-react";
import { useMemo, useRef, useState } from "react";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

async function readFileAsBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تعذر قراءة الملف من الجهاز."));
    reader.readAsDataURL(file);
  });
  return dataUrl.split(",", 2)[1] ?? "";
}

export default function ContentPosts() {
  const profile = trpc.access.myProfile.useQuery();
  const utils = trpc.useUtils();
  const canManageMarketing = profile.data?.permissions.includes("marketing.manage") ?? false;
  const canEditProducts = profile.data?.permissions.includes("products.edit") ?? false;
  const products = trpc.products.list.useQuery(undefined, { enabled: profile.isSuccess && canManageMarketing });
  const drafts = trpc.content.listDrafts.useQuery(undefined, { enabled: profile.isSuccess && canManageMarketing });
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [newProductId, setNewProductId] = useState("");
  const [caption, setCaption] = useState("");
  const [attachProductId, setAttachProductId] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedPost = trpc.content.byId.useQuery({ postId: selectedPostId ?? 0 }, { enabled: selectedPostId !== null && canManageMarketing });
  const createDraft = trpc.content.createDraft.useMutation({
    onSuccess: async ({ postId }) => {
      setSelectedPostId(postId);
      setCaption("");
      setNewProductId("");
      await drafts.refetch();
    },
  });
  const uploadMedia = trpc.content.uploadPostMedia.useMutation({
    onSuccess: async () => {
      if (selectedPostId) await selectedPost.refetch();
    },
  });
  const attachToProduct = trpc.content.attachPostMediaToProduct.useMutation({
    onSuccess: async () => {
      if (selectedPostId) await selectedPost.refetch();
      await utils.products.list.invalidate();
    },
  });

  const selectedPostProductId = selectedPost.data?.post.productId ?? null;
  const targetProductId = useMemo(() => Number(attachProductId || selectedPostProductId || 0), [attachProductId, selectedPostProductId]);

  const create = () => {
    createDraft.mutate({
      productId: newProductId ? Number(newProductId) : undefined,
      caption: caption.trim() || undefined,
    });
  };

  const upload = async (file: File) => {
    if (!selectedPostId) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return;
    if (file.size === 0 || file.size > MAX_FILE_SIZE) return;
    uploadMedia.mutate({ postId: selectedPostId, fileName: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", base64Data: await readFileAsBase64(file) });
  };

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-6 pb-10">
      <header className="rounded-[2rem] bg-[#3d2751] px-6 py-7 text-white shadow-[0_22px_50px_rgba(61,39,81,0.2)] sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="mb-3 flex w-fit items-center gap-2 rounded-full border border-[#ead3ff]/25 bg-white/[0.08] px-3 py-1 text-xs text-[#f1ddff]"><NotebookPen className="h-3.5 w-3.5" />مسودات المحتوى — تجربة محدودة</div><h1 className="text-2xl font-bold">أضف للمنشور ما تحتاجه، من دون تغيير المنتج تلقائيًا.</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[#eadff0]">الصور التي ترفعها هنا تبقى داخل مسودة المنشور. إضافة صورة إلى المنتج إجراء اختياري مستقل.</p></div>
          <Badge className="bg-[#f5e9c9] text-[#6a4b0f] hover:bg-[#f5e9c9]">لا نشر فعلي في هذه المرحلة</Badge>
        </div>
      </header>

      {!canManageMarketing && profile.isSuccess && <div className="rounded-2xl border border-[#f0d6bc] bg-[#fff7ef] p-4 text-sm text-[#90502e]">لا تملك حاليًا صلاحية إدارة مسودات المحتوى.</div>}

      {canManageMarketing && <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="space-y-5 rounded-2xl border border-[#e7ddeb] bg-white p-5 shadow-[0_12px_30px_rgba(61,39,81,0.06)]">
          <div><h2 className="font-bold text-[#3d2751]">مسودة منشور جديدة</h2><p className="mt-1 text-xs leading-5 text-[#756a7c]">يمكن ربط المسودة بمنتج أو تركها مستقلة. الربط لا ينسخ صورًا إلى المنتج.</p></div>
          <label className="block text-sm text-[#5e5464]">المنتج المرتبط — اختياري<select value={newProductId} onChange={event => setNewProductId(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"><option value="">منشور مستقل</option>{products.data?.map(product => <option key={product.id} value={product.id}>{product.productCode} — {product.name}</option>)}</select></label>
          <label className="block text-sm text-[#5e5464]">نص أولي للمنشور — اختياري<Textarea value={caption} onChange={event => setCaption(event.target.value)} placeholder="اكتب فكرة أو نص المنشور..." className="mt-1.5 min-h-28" /></label>
          {createDraft.error && <p className="rounded-lg bg-[#fff4ed] p-3 text-xs text-[#9c4b25]">{createDraft.error.message}</p>}
          <Button onClick={create} disabled={createDraft.isPending} className="w-full bg-[#5b3674] hover:bg-[#452759]"><Plus className="ml-2 h-4 w-4" />{createDraft.isPending ? "جارٍ إنشاء المسودة..." : "إنشاء مسودة منشور"}</Button>
          <div className="border-t border-[#eee8f1] pt-4"><p className="text-xs font-bold text-[#756a7c]">المسودات الأخيرة</p><div className="mt-2 space-y-2">{drafts.data?.map(post => <button key={post.id} onClick={() => setSelectedPostId(post.id)} className={`w-full rounded-lg border p-3 text-right text-xs transition-colors ${selectedPostId === post.id ? "border-[#b998d2] bg-[#f8f2fc]" : "border-[#eee8f1] hover:bg-[#fbf9fc]"}`}><b>مسودة #{post.id}</b><span className="mr-2 text-[#756a7c]">{post.productId ? "مرتبطة بمنتج" : "مستقلة"}</span></button>)}{drafts.data?.length === 0 && <p className="rounded-lg bg-[#faf8fb] p-3 text-xs text-[#756a7c]">لا توجد مسودات بعد.</p>}</div></div>
        </section>

        <section className="rounded-2xl border border-[#e7ddeb] bg-white p-5 shadow-[0_12px_30px_rgba(61,39,81,0.06)]">
          {!selectedPostId && <div className="grid min-h-96 place-items-center rounded-2xl border border-dashed border-[#d8cce1] bg-[#fbf9fc] p-8 text-center"><ImagePlus className="h-8 w-8 text-[#8b6aa1]" /><div><h2 className="mt-3 font-bold text-[#493657]">اختر أو أنشئ مسودة</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[#756a7c]">بعد اختيار المسودة تستطيع رفع صورة من الهاتف أو الكمبيوتر. تبقى الصورة للمنشور وحده افتراضيًا.</p></div></div>}
          {selectedPost.isLoading && <div className="rounded-xl bg-[#fbf9fc] p-5 text-sm text-[#5b3674]">جارٍ فتح مسودة المنشور...</div>}
          {selectedPost.error && <div className="rounded-xl bg-[#fff4ed] p-4 text-sm text-[#9c4b25]">{selectedPost.error.message}</div>}
          {selectedPost.data && <div className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-lg font-bold text-[#3d2751]">مسودة منشور #{selectedPost.data.post.id}</h2><Badge className="bg-[#f3ebf8] text-[#5b3674] hover:bg-[#f3ebf8]">مسودة</Badge></div><p className="mt-1 text-sm text-[#756a7c]">{selectedPostProductId ? "هذه المسودة مرتبطة بمنتج، لكن وسائطها لا تُضاف إليه تلقائيًا." : "مسودة مستقلة؛ تستطيع اختيار منتج فقط عند استخدام خيار الإضافة الاختياري."}</p></div><Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploadMedia.isPending} className="border-[#b998d2] text-[#5b3674] hover:bg-[#f8f2fc]"><UploadCloud className="ml-2 h-4 w-4" />{uploadMedia.isPending ? "جارٍ رفع الصورة..." : "إضافة صورة للمنشور"}</Button><Input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} /></div>
            {uploadMedia.error && <p className="rounded-lg bg-[#fff4ed] p-3 text-sm text-[#9c4b25]">{uploadMedia.error.message}</p>}
            <div className="grid gap-4 sm:grid-cols-2">{selectedPost.data.media.map(media => <article key={media.id} className="overflow-hidden rounded-xl border border-[#ece5f0] bg-[#fcfbfd]"><img src={`/manus-storage/${media.storageKey}`} alt={media.originalFileName} className="aspect-[4/3] w-full object-cover" /><div className="space-y-3 p-3"><p className="truncate text-xs text-[#5e5464]" title={media.originalFileName}>{media.originalFileName}</p>{media.linkedProductMediaId ? <p className="rounded-md bg-[#edf7f1] p-2 text-xs text-[#1f5b4f]">أضيفت هذه الصورة إلى المنتج باختيار صريح. بقيت أيضًا داخل المنشور.</p> : <div className="space-y-2"><p className="text-xs leading-5 text-[#756a7c]">هذه الصورة تخص المنشور فقط حاليًا.</p>{canEditProducts && <><select value={attachProductId || String(selectedPostProductId ?? "")} onChange={event => setAttachProductId(event.target.value)} className="h-9 w-full rounded-md border border-input bg-white px-2 text-xs"><option value="">اختر منتجًا لإضافة اختيارية</option>{products.data?.map(product => <option key={product.id} value={product.id}>{product.productCode} — {product.name}</option>)}</select><Button size="sm" variant="outline" onClick={() => targetProductId && attachToProduct.mutate({ postId: selectedPost.data.post.id, postMediaId: media.id, productId: targetProductId })} disabled={!targetProductId || attachToProduct.isPending} className="w-full border-[#9dc2b2] text-[#2d5a4d] hover:bg-[#edf7f1]"><Link2 className="ml-2 h-3.5 w-3.5" />إضافة هذه الصورة إلى المنتج أيضًا</Button></>}</div>}</div></article>)}{selectedPost.data.media.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-[#dacde3] bg-[#fbf9fc] p-8 text-center text-sm text-[#756a7c]">لا توجد وسائط في هذه المسودة. أضف صورة من جهازك إن رغبت.</div>}</div>
            {attachToProduct.error && <p className="rounded-lg bg-[#fff4ed] p-3 text-sm text-[#9c4b25]">{attachToProduct.error.message}</p>}
          </div>}
        </section>
      </div>}
    </div>
  );
}
