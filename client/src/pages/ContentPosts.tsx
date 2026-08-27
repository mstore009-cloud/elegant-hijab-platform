import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import {
  Archive,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  FilePlus2,
  ImagePlus,
  Link2,
  Loader2,
  MessageSquareText,
  NotebookPen,
  PenLine,
  Send,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

type PostStatus = "draft" | "needs_review" | "approved" | "changes_requested" | "archived";
type ContentType = "feed_post" | "story" | "reel" | "catalog" | "other";
type ChannelPlan = "general" | "facebook" | "instagram" | "tiktok" | "whatsapp";

type PostForm = {
  title: string;
  productId: string;
  contentType: ContentType;
  channelPlan: ChannelPlan;
  plannedFor: string;
  caption: string;
};

const emptyForm: PostForm = { title: "", productId: "", contentType: "feed_post", channelPlan: "general", plannedFor: "", caption: "" };

const statusMeta: Record<PostStatus, { label: string; className: string }> = {
  draft: { label: "مسودة", className: "bg-[#f2efe8] text-[#6b716d]" },
  needs_review: { label: "بانتظار المراجعة", className: "bg-[#fff3d9] text-[#916d21]" },
  approved: { label: "معتمدة داخلياً", className: "bg-[#e7f4ee] text-[#1d6b50]" },
  changes_requested: { label: "تحتاج تعديلاً", className: "bg-[#fceae6] text-[#a55341]" },
  archived: { label: "مؤرشفة", className: "bg-[#edf0ee] text-[#68746d]" },
};

const typeMeta: Record<ContentType, string> = { feed_post: "منشور", story: "قصة", reel: "فيديو قصير", catalog: "كتالوج", other: "أخرى" };
const channelMeta: Record<ChannelPlan, string> = { general: "عام", facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", whatsapp: "WhatsApp" };

async function readFileAsBase64(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("تعذر قراءة الملف من الجهاز."));
    reader.readAsDataURL(file);
  });
  return dataUrl.split(",", 2)[1] ?? "";
}

function formatDate(value: Date | null | undefined, withTime = false) {
  if (!value) return "غير محدد";
  return new Intl.DateTimeFormat("ar-IQ", withTime ? { dateStyle: "medium", timeStyle: "short" } : { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function toLocalDateTimeValue(value: Date | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formFromPost(post: { title: string | null; productId: number | null; contentType: ContentType; channelPlan: ChannelPlan; plannedFor: Date | null; caption: string | null }): PostForm {
  return { title: post.title ?? "", productId: post.productId ? String(post.productId) : "", contentType: post.contentType, channelPlan: post.channelPlan, plannedFor: toLocalDateTimeValue(post.plannedFor), caption: post.caption ?? "" };
}

function postMediaUrl(key: string) {
  return key.startsWith("/") ? key : `/manus-storage/${key}`;
}

function calendarDays(cursor: Date) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const leading = (first.getDay() + 1) % 7;
  return Array.from({ length: leading + lastDay }, (_, index) => (index < leading ? null : new Date(cursor.getFullYear(), cursor.getMonth(), index - leading + 1)));
}

export default function ContentPosts() {
  const profile = trpc.access.myProfile.useQuery();
  const utils = trpc.useUtils();
  const canView = profile.data?.permissions.includes("content.view") ?? false;
  const canManage = profile.data?.permissions.includes("content.manage") ?? false;
  const canApprove = profile.data?.permissions.includes("content.approve") ?? false;
  const canEditProducts = profile.data?.permissions.includes("products.edit") ?? false;
  const products = trpc.products.list.useQuery(undefined, { enabled: profile.isSuccess && canView });
  const overview = trpc.content.listDrafts.useQuery(undefined, { enabled: profile.isSuccess && canView });
  const [statusFilter, setStatusFilter] = useState<"all" | PostStatus>("all");
  const [channelFilter, setChannelFilter] = useState<"all" | ChannelPlan>("all");
  const filters = useMemo(() => ({ ...(statusFilter !== "all" ? { status: statusFilter } : {}), ...(channelFilter !== "all" ? { channelPlan: channelFilter } : {}) }), [statusFilter, channelFilter]);
  const posts = trpc.content.listDrafts.useQuery(filters, { enabled: profile.isSuccess && canView });
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const selectedPost = trpc.content.byId.useQuery({ postId: selectedPostId ?? 0 }, { enabled: selectedPostId !== null && canView });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<PostForm>(emptyForm);
  const [reviewNote, setReviewNote] = useState("");
  const [attachProductId, setAttachProductId] = useState("");
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    await Promise.all([utils.content.listDrafts.invalidate(), selectedPostId ? utils.content.byId.invalidate({ postId: selectedPostId }) : Promise.resolve()]);
  }, [selectedPostId, utils.content.byId, utils.content.listDrafts]);

  useEffect(() => {
    if (selectedPost.data?.post) {
      setForm(formFromPost(selectedPost.data.post));
      setCreating(false);
      setReviewNote("");
      setAttachProductId("");
    }
  }, [selectedPost.data?.post]);

  const createDraft = trpc.content.createDraft.useMutation({
    onSuccess: async ({ postId }) => {
      toast.success("أُنشئت مسودة المحتوى.");
      setSelectedPostId(postId);
      setCreating(false);
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const updateDraft = trpc.content.update.useMutation({ onSuccess: async () => { toast.success("حُفظت المسودة. إذا كانت معتمدة أو بانتظار المراجعة، عادت إلى مسودة."); await refresh(); }, onError: error => toast.error(error.message) });
  const requestReview = trpc.content.requestReview.useMutation({ onSuccess: async () => { toast.success("أُرسلت المسودة إلى طابور المراجعة الداخلي."); setReviewNote(""); await refresh(); }, onError: error => toast.error(error.message) });
  const review = trpc.content.review.useMutation({ onSuccess: async result => { toast.success(result.status === "approved" ? "اعتمدت المسودة داخلياً؛ لم تُنشر في أي قناة." : "أعيدت المسودة للتعديل."); setReviewNote(""); await refresh(); }, onError: error => toast.error(error.message) });
  const archive = trpc.content.archive.useMutation({ onSuccess: async () => { toast.success("أُرشفت المسودة من دون حذف وسائطها أو المنتج."); await refresh(); }, onError: error => toast.error(error.message) });
  const uploadMedia = trpc.content.uploadPostMedia.useMutation({ onSuccess: async () => { toast.success("أضيف الوسيط إلى المسودة فقط."); await refresh(); }, onError: error => toast.error(error.message) });
  const attachToProduct = trpc.content.attachPostMediaToProduct.useMutation({ onSuccess: async () => { toast.success("أُنشئت نسخة تشغيلية للمنتج؛ بقي الأصل داخل المسودة."); await refresh(); await utils.products.list.invalidate(); }, onError: error => toast.error(error.message) });

  const activePost = selectedPost.data?.post;
  const displayedPosts = posts.data ?? [];
  const allPosts = overview.data ?? [];
  const plannedByDay = useMemo(() => {
    const grouped = new Map<string, typeof allPosts>();
    allPosts.forEach(post => {
      if (!post.plannedFor || post.status === "archived") return;
      const date = new Date(post.plannedFor);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      const entries = grouped.get(key) ?? [];
      entries.push(post);
      grouped.set(key, entries);
    });
    return grouped;
  }, [allPosts]);
  const days = useMemo(() => calendarDays(monthCursor), [monthCursor]);
  const waitingReview = allPosts.filter(post => post.status === "needs_review");
  const stats = useMemo(() => ({ draft: allPosts.filter(post => post.status === "draft").length, review: waitingReview.length, approved: allPosts.filter(post => post.status === "approved").length, planned: allPosts.filter(post => post.plannedFor && post.status !== "archived").length }), [allPosts, waitingReview.length]);

  function openNew() {
    setSelectedPostId(null);
    setForm(emptyForm);
    setCreating(true);
    setReviewNote("");
  }

  function selectPost(postId: number) {
    setSelectedPostId(postId);
    setCreating(false);
  }

  function payloadFromForm() {
    return {
      title: form.title.trim() || null,
      productId: form.productId ? Number(form.productId) : null,
      contentType: form.contentType,
      channelPlan: form.channelPlan,
      plannedFor: form.plannedFor ? new Date(form.plannedFor) : null,
      caption: form.caption.trim() || null,
    };
  }

  async function upload(file: File) {
    if (!selectedPostId || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error("اختاري صورة بصيغة JPG أو PNG أو WebP.");
      return;
    }
    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      toast.error("حجم الصورة يجب ألا يتجاوز 20 ميغابايت.");
      return;
    }
    uploadMedia.mutate({ postId: selectedPostId, fileName: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", base64Data: await readFileAsBase64(file) });
  }

  if (profile.isLoading) return <ContentSkeleton />;
  if (!canView) return <ContentForbidden />;

  return <div dir="rtl" className="mx-auto max-w-7xl space-y-5 pb-10">
    <header className="overflow-hidden rounded-[1.9rem] border border-[#e5ddcc] bg-[radial-gradient(circle_at_88%_8%,#f3e2bc,transparent_34%),linear-gradient(135deg,#fffdfa,#f2f7f3)] px-5 py-6 shadow-[0_12px_30px_rgba(45,67,55,0.07)] sm:px-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-bold tracking-[0.15em] text-[#9a7b3e]">CONTENT STUDIO · INTERNAL WORKFLOW</p>
          <h1 className="mt-1.5 flex items-center gap-2 text-2xl font-bold text-[#263e35]"><NotebookPen className="h-6 w-6 text-[#1d5a4d]" />محتوى المتجر وتقويمه</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6b7971]">اكتبي المسودة، اربطي المنتج والوسيط، ثم اطلبي مراجعتها. الاعتماد داخلي فقط ولا ينشر أي محتوى إلى قناة خارجية.</p>
        </div>
        {canManage && <Button onClick={openNew} className="h-10 shrink-0 rounded-xl bg-[#1d5a4d] px-4 hover:bg-[#153f36]"><FilePlus2 className="ml-2 h-4 w-4" />مسودة جديدة</Button>}
      </div>
    </header>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Metric label="مسودات العمل" value={stats.draft} tone="stone" />
      <Metric label="بانتظار المراجعة" value={stats.review} tone="amber" />
      <Metric label="معتمدة داخلياً" value={stats.approved} tone="green" />
      <Metric label="تواريخ مخططة" value={stats.planned} tone="blue" />
    </section>

    <section className="rounded-2xl border border-[#e7e1d5] bg-white p-4 shadow-[0_10px_25px_rgba(40,61,51,0.05)] sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 font-bold text-[#30473d]"><CalendarDays className="h-4.5 w-4.5 text-[#1d5a4d]" />التقويم التنظيمي</h2><p className="mt-1 text-xs leading-5 text-[#7a8880]">التاريخ للتخطيط ومتابعة المراجعة فقط؛ لا يشغل جدولة أو نشرًا تلقائيًا.</p></div><div className="flex items-center gap-2 self-start rounded-xl bg-[#f5f3ed] p-1"><Button size="icon" variant="ghost" onClick={() => setMonthCursor(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="h-8 w-8 rounded-lg"><ChevronRight className="h-4 w-4" /></Button><p className="min-w-28 text-center text-sm font-bold text-[#40554b]">{new Intl.DateTimeFormat("ar-IQ", { month: "long", year: "numeric" }).format(monthCursor)}</p><Button size="icon" variant="ghost" onClick={() => setMonthCursor(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="h-8 w-8 rounded-lg"><ChevronLeft className="h-4 w-4" /></Button></div></div>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-[#8a968f]">{["س", "ح", "ن", "ث", "ر", "خ", "ج"].map(day => <div key={day} className="py-1">{day}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">{days.map((day, index) => {
        if (!day) return <div key={`empty-${index}`} className="min-h-18 rounded-lg bg-[#fbfaf7]" />;
        const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
        const dayPosts = plannedByDay.get(key) ?? [];
        const today = new Date();
        return <div key={key} className={`min-h-18 rounded-lg border p-1.5 text-right ${today.toDateString() === day.toDateString() ? "border-[#9fc8b4] bg-[#f3faf6]" : "border-[#eee9dd] bg-[#fffefd]"}`}><p className="text-xs font-bold text-[#53675e]">{day.getDate()}</p><div className="mt-1 space-y-1">{dayPosts.slice(0, 2).map(post => <button key={post.id} onClick={() => selectPost(post.id)} className="block w-full truncate rounded px-1.5 py-1 text-right text-[9px] font-medium text-[#326052] hover:bg-[#e5f1ea]" title={post.title ?? post.caption ?? "مسودة بلا عنوان"}>{post.title ?? post.caption ?? `مسودة #${post.id}`}</button>)}{dayPosts.length > 2 && <p className="px-1 text-[9px] text-[#9a7b3e]">+{dayPosts.length - 2} أخرى</p>}</div></div>;
      })}</div>
    </section>

    <div className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
      <aside className="space-y-5">
        <section className="rounded-2xl border border-[#e7e1d5] bg-white p-5 shadow-[0_10px_25px_rgba(40,61,51,0.05)]"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-[#30473d]">طابور المراجعة</h2><p className="mt-1 text-xs leading-5 text-[#77847d]">لا يخرج أي نص من المنصة قبل المراجعة، ولا يعني الاعتماد نشراً خارجياً.</p></div><Badge className="bg-[#fff3d9] text-[#916d21]">{waitingReview.length}</Badge></div>{overview.isLoading ? <RowsSkeleton count={2} /> : waitingReview.length ? <div className="mt-4 space-y-2">{waitingReview.slice(0, 5).map(post => <button key={post.id} onClick={() => selectPost(post.id)} className={`w-full rounded-xl border p-3 text-right transition ${selectedPostId === post.id ? "border-[#9ac5af] bg-[#f3faf6]" : "border-[#eee9dd] hover:bg-[#fafbf8]"}`}><p className="truncate text-sm font-bold text-[#40564c]">{post.title ?? "مسودة بلا عنوان"}</p><p className="mt-1 text-xs text-[#839087]">{channelMeta[post.channelPlan]} · {formatDate(post.plannedFor)}</p></button>)}</div> : <EmptyState icon={<ClipboardCheck />} title="لا توجد مسودات بانتظار المراجعة" body="عند طلب مراجعة مسودة ستظهر هنا للمراجع المخوّل." />}</section>
        <section className="rounded-2xl border border-[#e7e1d5] bg-white p-5 shadow-[0_10px_25px_rgba(40,61,51,0.05)]"><div className="flex items-center justify-between"><h2 className="font-bold text-[#30473d]">كل المسودات</h2><span className="text-xs text-[#839087]">{displayedPosts.length}</span></div><div className="mt-4 grid grid-cols-2 gap-2"><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as "all" | PostStatus)} className="h-9 rounded-lg border border-[#e3dfd4] bg-white px-2 text-xs text-[#5c6e64]"><option value="all">كل الحالات</option>{Object.entries(statusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}</select><select value={channelFilter} onChange={event => setChannelFilter(event.target.value as "all" | ChannelPlan)} className="h-9 rounded-lg border border-[#e3dfd4] bg-white px-2 text-xs text-[#5c6e64]"><option value="all">كل القنوات</option>{Object.entries(channelMeta).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>{posts.isLoading ? <RowsSkeleton count={4} /> : displayedPosts.length ? <div className="mt-3 space-y-2">{displayedPosts.map(post => <button key={post.id} onClick={() => selectPost(post.id)} className={`w-full rounded-xl border p-3 text-right transition ${selectedPostId === post.id ? "border-[#9ac5af] bg-[#f3faf6]" : "border-[#eee9dd] hover:bg-[#fafbf8]"}`}><div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-sm font-bold text-[#40564c]">{post.title ?? "مسودة بلا عنوان"}</p><Badge className={`shrink-0 ${statusMeta[post.status].className}`}>{statusMeta[post.status].label}</Badge></div><p className="mt-1.5 truncate text-xs text-[#829087]">{post.caption ?? "لا يوجد نص بعد"}</p><p className="mt-2 text-[11px] text-[#9a7b3e]">{channelMeta[post.channelPlan]} · {formatDate(post.plannedFor)}</p></button>)}</div> : <EmptyState icon={<NotebookPen />} title="لا تطابق الفلاتر أي مسودة" body="غيري الفلاتر أو أنشئي مسودة جديدة." />}</section>
      </aside>

      <section className="min-w-0 rounded-2xl border border-[#e7e1d5] bg-white p-5 shadow-[0_10px_25px_rgba(40,61,51,0.05)] sm:p-6">
        {!creating && !selectedPostId && <div className="grid min-h-115 place-items-center rounded-2xl border border-dashed border-[#d5dfd7] bg-[#fbfdfb] p-8 text-center"><NotebookPen className="h-9 w-9 text-[#7ea990]" /><div><h2 className="mt-3 text-lg font-bold text-[#395148]">اختاري مسودة أو ابدئي فكرة جديدة</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[#77857d]">ستجدين هنا النص والوسائط والمنتج والتاريخ وسجل الاعتماد في مساحة واحدة.</p>{canManage && <Button onClick={openNew} className="mt-5 rounded-xl bg-[#1d5a4d] hover:bg-[#153f36]"><FilePlus2 className="ml-2 h-4 w-4" />مسودة جديدة</Button>}</div></div>}
        {selectedPost.isLoading && <div className="flex min-h-96 items-center justify-center text-sm text-[#62766b]"><Loader2 className="ml-2 h-4 w-4 animate-spin" />جارٍ فتح مسودة المحتوى…</div>}
        {selectedPost.error && <div className="rounded-xl border border-[#f0d3c7] bg-[#fff7f2] p-4 text-sm text-[#9b5036]">{selectedPost.error.message}</div>}
        {(creating || activePost) && <div className="space-y-6"><div className="flex flex-col gap-3 border-b border-[#eee9dd] pb-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-bold text-[#30473d]">{creating ? "مسودة محتوى جديدة" : activePost?.title || "مسودة بلا عنوان"}</h2>{activePost && <Badge className={statusMeta[activePost.status].className}>{statusMeta[activePost.status].label}</Badge>}</div><p className="mt-1.5 text-xs leading-5 text-[#7a8880]">الاعتماد مسار داخلي مستقل. لا توجد قناة موصولة أو زر نشر في هذه الدفعة.</p></div>{activePost && <p className="text-xs text-[#849087]">آخر تعديل: {formatDate(activePost.updatedAt, true)}</p>}</div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="عنوان داخلي للمسودة"><Input value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="مثال: إطلالة زيتية للعمل" disabled={!canManage} /></Field><Field label="المنتج المرتبط — اختياري"><select value={form.productId} onChange={event => setForm(current => ({ ...current, productId: event.target.value }))} disabled={!canManage} className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm"><option value="">منشور مستقل</option>{products.data?.map(product => <option key={product.id} value={product.id}>{product.productCode} — {product.name}</option>)}</select></Field><Field label="نوع المحتوى"><select value={form.contentType} onChange={event => setForm(current => ({ ...current, contentType: event.target.value as ContentType }))} disabled={!canManage} className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm">{Object.entries(typeMeta).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="القناة المخطط لها"><select value={form.channelPlan} onChange={event => setForm(current => ({ ...current, channelPlan: event.target.value as ChannelPlan }))} disabled={!canManage} className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm">{Object.entries(channelMeta).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="تاريخ التخطيط — اختياري" className="sm:col-span-2"><Input type="datetime-local" value={form.plannedFor} onChange={event => setForm(current => ({ ...current, plannedFor: event.target.value }))} disabled={!canManage} /></Field></div>
          <Field label="النص أو الفكرة"><Textarea value={form.caption} onChange={event => setForm(current => ({ ...current, caption: event.target.value }))} placeholder="اكتبي الفكرة، النص، الهاشتاغات أو ملاحظات المراجع…" className="min-h-34 leading-7" disabled={!canManage} /></Field>
          {canManage && <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => { if (activePost) setForm(formFromPost(activePost)); else { setCreating(false); setForm(emptyForm); } }} disabled={createDraft.isPending || updateDraft.isPending} className="rounded-xl">إلغاء التعديلات</Button><Button onClick={() => creating ? createDraft.mutate(payloadFromForm()) : activePost && updateDraft.mutate({ postId: activePost.id, ...payloadFromForm() })} disabled={createDraft.isPending || updateDraft.isPending} className="rounded-xl bg-[#1d5a4d] hover:bg-[#153f36]"><PenLine className="ml-2 h-4 w-4" />{createDraft.isPending || updateDraft.isPending ? "جارٍ الحفظ…" : creating ? "إنشاء المسودة" : "حفظ التعديلات"}</Button></div>}
          {activePost && <ContentActions post={activePost} canManage={canManage} canApprove={canApprove} reviewNote={reviewNote} onReviewNoteChange={setReviewNote} onRequestReview={() => requestReview.mutate({ postId: activePost.id, note: reviewNote.trim() || null })} onReview={decision => review.mutate({ postId: activePost.id, decision, note: reviewNote.trim() || null })} onArchive={() => archive.mutate({ postId: activePost.id, note: reviewNote.trim() || null })} busy={requestReview.isPending || review.isPending || archive.isPending} />}
          {activePost && <MediaPanel postId={activePost.id} media={selectedPost.data?.media ?? []} selectedProductId={activePost.productId} products={products.data ?? []} canManage={canManage} canEditProducts={canEditProducts} fileInputRef={fileInputRef} attachProductId={attachProductId} onAttachProductIdChange={setAttachProductId} onUpload={upload} uploading={uploadMedia.isPending} onAttach={(postMediaId, productId) => attachToProduct.mutate({ postId: activePost.id, postMediaId, productId })} attaching={attachToProduct.isPending} />}
          {activePost && <ActivityPanel activities={selectedPost.data?.activities ?? []} />}
        </div>}
      </section>
    </div>
  </div>;
}

function ContentActions({ post, canManage, canApprove, reviewNote, onReviewNoteChange, onRequestReview, onReview, onArchive, busy }: { post: { status: PostStatus }; canManage: boolean; canApprove: boolean; reviewNote: string; onReviewNoteChange: (value: string) => void; onRequestReview: () => void; onReview: (decision: "approved" | "changes_requested") => void; onArchive: () => void; busy: boolean }) {
  if (post.status === "archived") return <div className="rounded-xl border border-[#e1e4e0] bg-[#f4f6f3] p-4 text-sm text-[#6b766f]">هذه المسودة مؤرشفة. لم تحذف وسائطها أو المنتج المرتبط بها، ولا يمكن نشرها من هذه الصفحة.</div>;
  return <section className="rounded-2xl border border-[#e7e1d5] bg-[#fffefa] p-4"><div className="flex items-start gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#96732d]" /><div><h3 className="font-bold text-[#5b513b]">المراجعة الداخلية</h3><p className="mt-1 text-xs leading-5 text-[#80755d]">اكتبي ملاحظة اختيارية للمنشئ أو للمراجع. لا يرسل أي زر هنا رسالة أو منشوراً إلى الخارج.</p></div></div><Textarea value={reviewNote} onChange={event => onReviewNoteChange(event.target.value)} placeholder="ملاحظة للمراجعة أو سبب طلب التعديل…" className="mt-3 min-h-20 bg-white text-sm" /><div className="mt-3 flex flex-wrap justify-end gap-2">{canManage && (post.status === "draft" || post.status === "changes_requested") && <Button disabled={busy} onClick={onRequestReview} className="rounded-xl bg-[#9a7b3e] hover:bg-[#795f2f]"><Send className="ml-2 h-4 w-4" />طلب مراجعة</Button>}{canApprove && post.status === "needs_review" && <><Button disabled={busy} variant="outline" onClick={() => onReview("changes_requested")} className="rounded-xl border-[#dfa794] text-[#a55440] hover:bg-[#fff2ed]"><MessageSquareText className="ml-2 h-4 w-4" />طلب تعديل</Button><Button disabled={busy} onClick={() => onReview("approved")} className="rounded-xl bg-[#1d5a4d] hover:bg-[#153f36]"><CheckCircle2 className="ml-2 h-4 w-4" />اعتماد داخلي</Button></>}{canManage && <Button disabled={busy} variant="outline" onClick={onArchive} className="rounded-xl border-[#e0d6ca] text-[#776b5e] hover:bg-[#f7f4ef]"><Archive className="ml-2 h-4 w-4" />أرشفة</Button>}</div></section>;
}

function MediaPanel({ postId, media, selectedProductId, products, canManage, canEditProducts, fileInputRef, attachProductId, onAttachProductIdChange, onUpload, uploading, onAttach, attaching }: { postId: number; media: Array<{ id: number; storageKey: string; originalFileName: string; linkedProductMediaId: number | null }>; selectedProductId: number | null; products: Array<{ id: number; productCode: string; name: string }>; canManage: boolean; canEditProducts: boolean; fileInputRef: React.RefObject<HTMLInputElement | null>; attachProductId: string; onAttachProductIdChange: (value: string) => void; onUpload: (file: File) => void; uploading: boolean; onAttach: (postMediaId: number, productId: number) => void; attaching: boolean }) {
  const targetProductId = Number(attachProductId || selectedProductId || 0);
  return <section className="border-t border-[#eee9dd] pt-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="flex items-center gap-2 font-bold text-[#30473d]"><ImagePlus className="h-4.5 w-4.5 text-[#1d5a4d]" />وسائط المسودة</h3><p className="mt-1 text-xs leading-5 text-[#7b8981]">تبقى الصورة داخل المسودة. إضافتها للمنتج قرار منفصل ينشئ نسخة تشغيلية ولا يغير الأصل.</p></div>{canManage && <><Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="h-9 rounded-xl border-[#9dc2b2] text-[#1d5a4d] hover:bg-[#edf7f1]"><UploadCloud className="ml-2 h-4 w-4" />{uploading ? "جارٍ الرفع…" : "إضافة صورة"}</Button><Input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void onUpload(file); event.currentTarget.value = ""; }} /></>}</div>{media.length ? <div className="mt-4 grid gap-4 sm:grid-cols-2">{media.map(item => <article key={item.id} className="overflow-hidden rounded-xl border border-[#ece5d9] bg-[#fffefd]"><img src={postMediaUrl(item.storageKey)} alt="وسيط مسودة المحتوى" className="aspect-[4/3] w-full object-cover" /><div className="space-y-3 p-3"><p className="truncate text-xs text-[#617168]" title={item.originalFileName}>{item.originalFileName}</p>{item.linkedProductMediaId ? <p className="rounded-lg bg-[#e9f5ee] p-2 text-xs leading-5 text-[#24614d]">هذه الصورة نُسخت تشغيلياً إلى المنتج باختيار صريح، وما زالت ضمن المسودة.</p> : canManage && canEditProducts ? <div className="space-y-2"><select value={attachProductId || String(selectedProductId ?? "")} onChange={event => onAttachProductIdChange(event.target.value)} className="h-9 w-full rounded-lg border border-[#ded9ce] bg-white px-2 text-xs"><option value="">اختاري منتجًا لإضافة اختيارية</option>{products.map(product => <option key={product.id} value={product.id}>{product.productCode} — {product.name}</option>)}</select><Button size="sm" variant="outline" onClick={() => targetProductId && onAttach(item.id, targetProductId)} disabled={!targetProductId || attaching} className="w-full rounded-lg border-[#9dc2b2] text-xs text-[#2d5a4d] hover:bg-[#edf7f1]"><Link2 className="ml-1.5 h-3.5 w-3.5" />إضافة هذه الصورة إلى المنتج أيضًا</Button></div> : <p className="text-xs text-[#7b8981]">هذه الصورة تخص المسودة فقط.</p>}</div></article>)}</div> : <EmptyState icon={<ImagePlus />} title="لا توجد وسائط في هذه المسودة" body="يمكن رفع صورة من الهاتف أو الكمبيوتر عند امتلاك صلاحية إدارة المحتوى." />}</section>;
}

function ActivityPanel({ activities }: { activities: Array<{ id: number; action: string; note: string | null; createdAt: Date; actorUserId: number | null }> }) {
  const labels: Record<string, string> = { created: "إنشاء المسودة", updated: "تعديل المسودة", review_requested: "طلب مراجعة", approved: "اعتماد داخلي", changes_requested: "طلب تعديل", archived: "أرشفة" };
  return <section className="border-t border-[#eee9dd] pt-6"><h3 className="font-bold text-[#30473d]">سجل المسودة</h3>{activities.length ? <ol className="mt-4 space-y-3 border-r border-[#dde7e0] pr-4">{activities.map(activity => <li key={activity.id} className="relative"><span className="absolute -right-[1.32rem] top-1 h-2.5 w-2.5 rounded-full bg-[#5c9980] ring-4 ring-white" /><p className="text-sm font-bold text-[#465b51]">{labels[activity.action] ?? activity.action}</p><p className="mt-1 text-xs text-[#849087]">{formatDate(activity.createdAt, true)}{activity.actorUserId ? ` · المستخدم #${activity.actorUserId}` : ""}</p>{activity.note && <p className="mt-1.5 text-xs leading-5 text-[#6e7d75]">{activity.note}</p>}</li>)}</ol> : <p className="mt-3 text-sm text-[#849087]">لا توجد أحداث بعد.</p>}</section>;
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) { return <label className={`block text-sm font-medium text-[#50645a] ${className}`}><span>{label}</span><div className="mt-1.5">{children}</div></label>; }
function Metric({ label, value, tone }: { label: string; value: number; tone: "stone" | "amber" | "green" | "blue" }) { const colors = { stone: "border-[#e7e2d8] bg-[#fffefd] text-[#67736d]", amber: "border-[#f1dfb8] bg-[#fffaf0] text-[#9a6f20]", green: "border-[#cee5d8] bg-[#f5fbf7] text-[#1d6b50]", blue: "border-[#d8e4eb] bg-[#f7fbfd] text-[#376c7d]" }; return <div className={`rounded-2xl border p-4 ${colors[tone]}`}><p className="text-2xl font-bold">{value}</p><p className="mt-1 text-xs font-medium">{label}</p></div>; }
function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) { return <div className="mt-4 rounded-xl border border-dashed border-[#dbe4dd] bg-[#fbfdfb] p-5 text-center"><div className="mx-auto w-fit text-[#76a08a]">{icon}</div><p className="mt-2 text-sm font-bold text-[#52665c]">{title}</p><p className="mt-1 text-xs leading-5 text-[#849087]">{body}</p></div>; }
function RowsSkeleton({ count }: { count: number }) { return <div className="mt-4 space-y-2">{Array.from({ length: count }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-xl bg-[#f4f5f2]" />)}</div>; }
function ContentSkeleton() { return <div className="mx-auto max-w-7xl space-y-5 pb-10"><div className="h-40 animate-pulse rounded-[1.9rem] bg-[#eef2ee]" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-22 animate-pulse rounded-2xl bg-[#f2f3ef]" />)}</div></div>; }
function ContentForbidden() { return <div dir="rtl" className="mx-auto grid max-w-xl place-items-center py-18 text-center"><div className="rounded-2xl border border-[#eed8cb] bg-[#fff8f3] p-7"><CircleAlert className="mx-auto h-8 w-8 text-[#a96146]" /><h1 className="mt-3 text-lg font-bold text-[#764735]">لا تملك صلاحية عرض المحتوى</h1><p className="mt-2 text-sm leading-6 text-[#926a5a]">تحتاج صلاحية «عرض تقويم ومسودات المحتوى» ضمن المتجر التشغيلي الحالي.</p></div></div>; }
