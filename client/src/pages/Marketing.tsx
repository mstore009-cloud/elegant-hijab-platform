import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Check, CircleDollarSign, ClipboardCheck, FileText, Loader2, Megaphone, Plus, ShieldAlert, Tags, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type CampaignStatus = "draft" | "needs_approval" | "approved" | "changes_requested" | "archived";
type AudienceType = "all_customers" | "customer_tag" | "relationship_stage";
type RelationshipStage = "new" | "active" | "repeat" | "needs_followup" | "inactive";

const statusLabels: Record<CampaignStatus, string> = {
  draft: "مسودة",
  needs_approval: "بانتظار الاعتماد",
  approved: "معتمدة داخلياً",
  changes_requested: "تحتاج تعديلاً",
  archived: "مؤرشفة",
};

const statusClasses: Record<CampaignStatus, string> = {
  draft: "bg-stone-100 text-stone-700 border-stone-200",
  needs_approval: "bg-amber-50 text-amber-800 border-amber-200",
  approved: "bg-emerald-50 text-emerald-800 border-emerald-200",
  changes_requested: "bg-rose-50 text-rose-800 border-rose-200",
  archived: "bg-slate-100 text-slate-600 border-slate-200",
};

const objectiveLabels = {
  product_launch: "إطلاق منتج",
  reengagement: "إعادة تفاعل العملاء",
  promotion: "عرض ترويجي",
  awareness: "تعريف بالعلامة",
  other: "هدف آخر",
} as const;

const stageLabels: Record<RelationshipStage, string> = {
  new: "عميلات جديدات",
  active: "عميلات نشطات",
  repeat: "عميلات متكررات",
  needs_followup: "يحتجن متابعة",
  inactive: "غير نشطات",
};

type CampaignForm = {
  name: string;
  objective: keyof typeof objectiveLabels;
  description: string;
  audienceType: AudienceType;
  audienceTagId: string;
  audienceStage: RelationshipStage;
  budgetAmount: string;
  budgetCurrency: string;
};

const emptyForm: CampaignForm = {
  name: "",
  objective: "product_launch",
  description: "",
  audienceType: "all_customers",
  audienceTagId: "",
  audienceStage: "new",
  budgetAmount: "0",
  budgetCurrency: "IQD",
};

function formatAmount(value: string | number, currency = "IQD") {
  const numeric = Number(value || 0);
  return new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 2 }).format(numeric) + " " + currency;
}

function campaignFormFrom(campaign: { name: string; objective: keyof typeof objectiveLabels; description: string | null; audienceType: AudienceType; audienceTagId: number | null; audienceStage: RelationshipStage | null; budgetAmount: string; budgetCurrency: string }): CampaignForm {
  return {
    name: campaign.name,
    objective: campaign.objective,
    description: campaign.description ?? "",
    audienceType: campaign.audienceType,
    audienceTagId: campaign.audienceTagId ? String(campaign.audienceTagId) : "",
    audienceStage: campaign.audienceStage ?? "new",
    budgetAmount: String(campaign.budgetAmount),
    budgetCurrency: campaign.budgetCurrency,
  };
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  return <Badge variant="outline" className={`shrink-0 font-normal ${statusClasses[status]}`}>{statusLabels[status]}</Badge>;
}

export default function Marketing() {
  const utils = trpc.useUtils();
  const [statusFilter, setStatusFilter] = useState<"all" | CampaignStatus>("all");
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | null>(null);
  const [form, setForm] = useState<CampaignForm>(emptyForm);
  const [budgetDraft, setBudgetDraft] = useState({ name: "", description: "", unitPrice: "", quantity: "1" });
  const [reviewNote, setReviewNote] = useState("");

  const campaignsQuery = trpc.marketing.list.useQuery(statusFilter === "all" ? undefined : { status: statusFilter });
  const tagsQuery = trpc.marketing.tags.useQuery();
  const approvedContentQuery = trpc.marketing.approvedContent.useQuery();
  const detailQuery = trpc.marketing.byId.useQuery({ campaignId: selectedCampaignId ?? 0 }, { enabled: selectedCampaignId !== null });
  const selected = detailQuery.data;

  const refresh = async () => {
    await Promise.all([utils.marketing.list.invalidate(), utils.marketing.byId.invalidate(), utils.marketing.approvedContent.invalidate(), utils.marketing.tags.invalidate()]);
  };

  useEffect(() => {
    if (selected?.campaign) setForm(campaignFormFrom(selected.campaign));
  }, [selected?.campaign?.id, selected?.campaign?.updatedAt]);

  const createCampaign = trpc.marketing.create.useMutation({
    onSuccess: async result => {
      setSelectedCampaignId(result.campaignId);
      await refresh();
      toast.success("أُنشئت الحملة كمسودة داخلية.");
    },
    onError: error => toast.error(error.message),
  });
  const updateCampaign = trpc.marketing.update.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const setContent = trpc.marketing.setContent.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const saveBudget = trpc.marketing.saveBudgetItem.useMutation({ onSuccess: () => { setBudgetDraft({ name: "", description: "", unitPrice: "", quantity: "1" }); refresh(); }, onError: error => toast.error(error.message) });
  const removeBudget = trpc.marketing.removeBudgetItem.useMutation({ onSuccess: refresh, onError: error => toast.error(error.message) });
  const requestApproval = trpc.marketing.requestApproval.useMutation({ onSuccess: () => { setReviewNote(""); refresh(); toast.success("أُحيلت الحملة إلى طابور الاعتماد الداخلي."); }, onError: error => toast.error(error.message) });
  const reviewCampaign = trpc.marketing.review.useMutation({ onSuccess: () => { setReviewNote(""); refresh(); toast.success("حُفظ قرار المراجعة. لم يُنشأ إعلان أو إنفاق."); }, onError: error => toast.error(error.message) });
  const archiveCampaign = trpc.marketing.archive.useMutation({ onSuccess: () => { refresh(); toast.success("أُرشفت الحملة الداخلية."); }, onError: error => toast.error(error.message) });

  const campaigns = campaignsQuery.data ?? [];
  const summary = useMemo(() => ({
    total: campaigns.length,
    awaiting: campaigns.filter(item => item.campaign.status === "needs_approval").length,
    approved: campaigns.filter(item => item.campaign.status === "approved").length,
    audience: campaigns.reduce((sum, item) => sum + item.audienceCount, 0),
  }), [campaigns]);
  const linkedIds = selected?.content.map(item => item.post.id) ?? [];
  const plannedItemTotal = selected?.budgetItems.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0) ?? 0;

  const saveCampaign = () => {
    if (!selectedCampaignId || !form.name.trim()) return toast.error("اكتبي اسم الحملة أولاً.");
    updateCampaign.mutate({
      campaignId: selectedCampaignId,
      name: form.name,
      objective: form.objective,
      description: form.description || null,
      audienceType: form.audienceType,
      audienceTagId: form.audienceType === "customer_tag" ? Number(form.audienceTagId) || null : null,
      audienceStage: form.audienceType === "relationship_stage" ? form.audienceStage : null,
      budgetAmount: Number(form.budgetAmount || 0),
      budgetCurrency: form.budgetCurrency,
    });
  };

  const toggleContent = (postId: number) => {
    if (!selectedCampaignId) return;
    const next = linkedIds.includes(postId) ? linkedIds.filter(id => id !== postId) : [...linkedIds, postId];
    setContent.mutate({ campaignId: selectedCampaignId, contentPostIds: next });
  };

  const addBudgetItem = () => {
    if (!selectedCampaignId) return;
    if (!budgetDraft.name.trim() || !budgetDraft.unitPrice) return toast.error("أدخلي اسم بند الميزانية وسعر الوحدة.");
    saveBudget.mutate({ campaignId: selectedCampaignId, name: budgetDraft.name, description: budgetDraft.description || null, unitPrice: Number(budgetDraft.unitPrice), quantity: Number(budgetDraft.quantity || 1) });
  };

  return (
    <div dir="rtl" className="mx-auto max-w-[1540px] space-y-5 pb-10">
      <section className="rounded-3xl border border-emerald-950/10 bg-[linear-gradient(115deg,#123e34,#1c5a49)] px-6 py-7 text-white shadow-[0_18px_45px_-24px_rgba(13,64,52,.9)] sm:px-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 text-xs text-emerald-100"><Megaphone className="h-4 w-4" /> مساحة التخطيط الداخلي</div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">الحملات التسويقية</h1>
            <p className="mt-2 text-sm leading-6 text-emerald-50/85">اربطي هدف الحملة بجمهور CRM ومحتوى معتمد وميزانية تخطيطية، ثم أرسليها لمراجعة داخلية. لا ينشئ هذا القسم إعلاناً أو إنفاقاً أو رسالة خارجية.</p>
          </div>
          <Button onClick={() => createCampaign.mutate({ name: "حملة جديدة", objective: "product_launch", audienceType: "all_customers", budgetAmount: 0, budgetCurrency: "IQD" })} disabled={createCampaign.isPending} className="bg-[#d9bb71] text-[#173d34] hover:bg-[#e6cb86]">
            {createCampaign.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Plus className="ml-2 h-4 w-4" />} حملة جديدة
          </Button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "إجمالي الحملات", value: summary.total, icon: Megaphone, tone: "text-emerald-700 bg-emerald-50" },
          { label: "بانتظار الاعتماد", value: summary.awaiting, icon: ClipboardCheck, tone: "text-amber-700 bg-amber-50" },
          { label: "معتمدة داخلياً", value: summary.approved, icon: Check, tone: "text-sky-700 bg-sky-50" },
          { label: "حجم الجمهور التقديري", value: summary.audience, icon: UsersRound, tone: "text-violet-700 bg-violet-50" },
        ].map(metric => <Card key={metric.label} className="border-stone-200/80 shadow-sm"><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs text-muted-foreground">{metric.label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{metric.value.toLocaleString("ar-IQ")}</p></div><span className={`rounded-2xl p-3 ${metric.tone}`}><metric.icon className="h-5 w-5" /></span></CardContent></Card>)}
      </section>

      <div className="grid gap-5 xl:grid-cols-[360px,minmax(0,1fr)]">
        <Card className="h-fit border-stone-200/90 shadow-sm">
          <CardHeader className="space-y-3 border-b border-stone-100 pb-4"><div className="flex items-center justify-between"><CardTitle className="text-base">قائمة الحملات</CardTitle><span className="text-xs text-muted-foreground">{campaigns.length} حملة</span></div>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as "all" | CampaignStatus)} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">
              <option value="all">كل الحالات</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </CardHeader>
          <CardContent className="space-y-2 p-3">
            {campaignsQuery.isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div> : campaignsQuery.error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">تعذر تحميل الحملات: {campaignsQuery.error.message}</p> : campaigns.length === 0 ? <div className="py-10 text-center"><Megaphone className="mx-auto h-7 w-7 text-stone-300" /><p className="mt-3 text-sm font-medium">لا توجد حملات بهذه الحالة</p><p className="mt-1 text-xs leading-5 text-muted-foreground">ابدئي بطاقة تخطيط؛ لن ينشأ إعلان أو إنفاق.</p></div> : campaigns.map(item => {
              const isActive = item.campaign.id === selectedCampaignId;
              return <button key={item.campaign.id} onClick={() => setSelectedCampaignId(item.campaign.id)} className={`w-full rounded-2xl border p-3 text-right transition-colors ${isActive ? "border-emerald-600 bg-emerald-50/60" : "border-transparent hover:border-stone-200 hover:bg-stone-50"}`}><div className="flex items-start justify-between gap-2"><p className="line-clamp-1 text-sm font-semibold">{item.campaign.name}</p><StatusBadge status={item.campaign.status} /></div><p className="mt-2 text-xs text-muted-foreground">{objectiveLabels[item.campaign.objective]} · جمهور تقديري {item.audienceCount.toLocaleString("ar-IQ")}</p><p className="mt-1 text-xs font-medium text-emerald-800">{formatAmount(item.campaign.budgetAmount, item.campaign.budgetCurrency)} تخطيطياً</p></button>;
            })}
          </CardContent>
        </Card>

        {!selectedCampaignId ? <Card className="min-h-[480px] border-dashed border-stone-300 bg-stone-50/50"><CardContent className="flex min-h-[480px] flex-col items-center justify-center text-center"><span className="rounded-3xl bg-emerald-100 p-4 text-emerald-800"><Megaphone className="h-7 w-7" /></span><h2 className="mt-5 text-lg font-semibold">اختاري حملة أو ابدئي واحدة جديدة</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">تجمع الحملة الهدف والجمهور التقريبي ومسودات المحتوى المعتمدة والميزانية التخطيطية في مساحة مراجعة واحدة.</p></CardContent></Card> : detailQuery.isLoading ? <Card><CardContent className="flex min-h-[480px] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent></Card> : detailQuery.error || !selected ? <Card><CardContent className="p-8 text-sm text-rose-700">تعذر تحميل تفاصيل الحملة. اختاريها من القائمة مجدداً.</CardContent></Card> : <div className="space-y-5">
          <Card className="border-stone-200/90 shadow-sm"><CardHeader className="border-b border-stone-100 pb-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-lg">تفاصيل الحملة</CardTitle><p className="mt-1 text-xs text-muted-foreground">الموافقة داخلية فقط؛ لا تفوض إنشاء إعلان أو دفع أو نشر.</p></div><StatusBadge status={selected.campaign.status} /></div></CardHeader><CardContent className="space-y-5 pt-5">
            <div className="grid gap-4 md:grid-cols-2"><label className="space-y-2 text-sm font-medium md:col-span-2"><span>اسم الحملة</span><Input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="مثال: إطلالة خريفية" /></label>
              <label className="space-y-2 text-sm font-medium"><span>الهدف</span><select value={form.objective} onChange={event => setForm(current => ({ ...current, objective: event.target.value as CampaignForm["objective"] }))} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">{Object.entries(objectiveLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="space-y-2 text-sm font-medium"><span>الميزانية التخطيطية</span><div className="flex gap-2"><Input type="number" min="0" value={form.budgetAmount} onChange={event => setForm(current => ({ ...current, budgetAmount: event.target.value }))} /><Input value={form.budgetCurrency} onChange={event => setForm(current => ({ ...current, budgetCurrency: event.target.value.toUpperCase() }))} className="w-24 text-center" maxLength={12} /></div></label>
              <label className="space-y-2 text-sm font-medium md:col-span-2"><span>ملخص أو ملاحظات الحملة</span><Textarea value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} placeholder="ماذا نريد تحقيقه؟ ولماذا هذا الجمهور؟" className="min-h-24" /></label>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4"><div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-emerald-700" /><h3 className="text-sm font-semibold">الجمهور المستهدف</h3><span className="mr-auto text-xs text-muted-foreground">{selected.audienceCount.toLocaleString("ar-IQ")} ملفاً تقديرياً</span></div><p className="mt-1 text-xs leading-5 text-muted-foreground">يُحسب العدد من ملفات CRM الحية، ولا تحفظ الحملة قائمة أرقام أو ترسل إليها شيئاً.</p><div className="mt-3 grid gap-3 md:grid-cols-2"><select value={form.audienceType} onChange={event => setForm(current => ({ ...current, audienceType: event.target.value as AudienceType }))} className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"><option value="all_customers">كل عميلات المتجر</option><option value="customer_tag">وفق وسم CRM</option><option value="relationship_stage">وفق مرحلة العلاقة</option></select>{form.audienceType === "customer_tag" ? <select value={form.audienceTagId} onChange={event => setForm(current => ({ ...current, audienceTagId: event.target.value }))} className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"><option value="">اختاري الوسم</option>{(tagsQuery.data ?? []).map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select> : form.audienceType === "relationship_stage" ? <select value={form.audienceStage} onChange={event => setForm(current => ({ ...current, audienceStage: event.target.value as RelationshipStage }))} className="h-10 rounded-xl border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring">{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <div className="flex items-center rounded-xl border border-dashed border-stone-300 bg-white px-3 text-sm text-muted-foreground">تتضمن كل ملفات العملاء في هذا المتجر.</div>}</div></div>
            <div className="flex justify-end"><Button onClick={saveCampaign} disabled={updateCampaign.isPending || selected.campaign.status === "archived"}>{updateCampaign.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : null}حفظ التخطيط</Button></div>
          </CardContent></Card>

          <div className="grid gap-5 lg:grid-cols-2"><Card className="border-stone-200/90 shadow-sm"><CardHeader><div className="flex items-center gap-2"><FileText className="h-4 w-4 text-emerald-700" /><CardTitle className="text-base">محتوى الحملة المعتمد</CardTitle></div><p className="text-xs leading-5 text-muted-foreground">لا يمكن اختيار سوى مسودات Content-A المعتمدة داخل المتجر.</p></CardHeader><CardContent className="space-y-2">{approvedContentQuery.isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (approvedContentQuery.data ?? []).length === 0 ? <p className="rounded-xl bg-stone-50 p-3 text-sm text-muted-foreground">لا توجد مسودات محتوى معتمدة بعد. اعتمدي مسودة من قسم المحتوى أولاً.</p> : (approvedContentQuery.data ?? []).map(post => <label key={post.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 p-3 hover:bg-stone-50"><input type="checkbox" checked={linkedIds.includes(post.id)} disabled={setContent.isPending || selected.campaign.status === "archived"} onChange={() => toggleContent(post.id)} className="mt-0.5 h-4 w-4 accent-emerald-700" /><span className="min-w-0"><span className="block text-sm font-medium">{post.title || "مسودة بلا عنوان"}</span><span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{post.caption || "لا يوجد نص مرافق"}</span></span></label>)}</CardContent></Card>
            <Card className="border-stone-200/90 shadow-sm"><CardHeader><div className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-emerald-700" /><CardTitle className="text-base">بنود الميزانية التخطيطية</CardTitle></div><p className="text-xs text-muted-foreground">الإجمالي المفصل {formatAmount(plannedItemTotal, selected.campaign.budgetCurrency)}. لا يوجد إنفاق فعلي هنا.</p></CardHeader><CardContent className="space-y-3">{selected.budgetItems.map(item => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 p-3"><div><p className="text-sm font-medium">{item.name}</p><p className="text-xs text-muted-foreground">{item.quantity.toLocaleString("ar-IQ")} × {formatAmount(item.unitPrice, selected.campaign.budgetCurrency)}</p></div><Button size="sm" variant="ghost" disabled={removeBudget.isPending || selected.campaign.status === "archived"} onClick={() => removeBudget.mutate({ campaignId: selectedCampaignId, budgetItemId: item.id })} className="text-rose-700 hover:bg-rose-50 hover:text-rose-800">إزالة</Button></div>)}<div className="grid gap-2 rounded-xl bg-stone-50 p-3 sm:grid-cols-[1fr_110px_80px_auto]"><Input value={budgetDraft.name} onChange={event => setBudgetDraft(current => ({ ...current, name: event.target.value }))} placeholder="اسم البند" /><Input type="number" min="0" value={budgetDraft.unitPrice} onChange={event => setBudgetDraft(current => ({ ...current, unitPrice: event.target.value }))} placeholder="سعر الوحدة" /><Input type="number" min="1" value={budgetDraft.quantity} onChange={event => setBudgetDraft(current => ({ ...current, quantity: event.target.value }))} /><Button variant="outline" onClick={addBudgetItem} disabled={saveBudget.isPending || selected.campaign.status === "archived"}>{saveBudget.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}</Button></div></CardContent></Card></div>

          <Card className="border-stone-200/90 shadow-sm"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-base">المراجعة والقرار</CardTitle><p className="mt-1 text-xs leading-5 text-muted-foreground">اعتماد التخطيط لا ينشئ إعلاناً أو رسالة أو عملية دفع.</p></div>{selected.campaign.status !== "archived" && <Button variant="ghost" onClick={() => archiveCampaign.mutate({ campaignId: selectedCampaignId })} disabled={archiveCampaign.isPending} className="text-rose-700 hover:bg-rose-50 hover:text-rose-800">أرشفة الحملة</Button>}</div></CardHeader><CardContent className="space-y-3"><Textarea value={reviewNote} onChange={event => setReviewNote(event.target.value)} placeholder="ملاحظة اختيارية للمراجع أو للفريق" className="min-h-20" />{selected.campaign.status === "draft" || selected.campaign.status === "changes_requested" ? <Button onClick={() => requestApproval.mutate({ campaignId: selectedCampaignId, note: reviewNote || null })} disabled={requestApproval.isPending || linkedIds.length === 0}>{requestApproval.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="ml-2 h-4 w-4" />}طلب اعتماد داخلي</Button> : selected.campaign.status === "needs_approval" ? <div className="flex flex-wrap gap-2"><Button onClick={() => reviewCampaign.mutate({ campaignId: selectedCampaignId, decision: "approved", note: reviewNote || null })} disabled={reviewCampaign.isPending} className="bg-emerald-700 hover:bg-emerald-800"><Check className="ml-2 h-4 w-4" />اعتماد التخطيط</Button><Button variant="outline" onClick={() => reviewCampaign.mutate({ campaignId: selectedCampaignId, decision: "changes_requested", note: reviewNote || null })} disabled={reviewCampaign.isPending}>طلب تعديل</Button></div> : <p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">هذه الحملة معتمدة داخلياً. أي تعديل جوهري سيعيدها إلى مسودة للمراجعة.</p>}<div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs leading-5 text-amber-900"><ShieldAlert className="ml-1 inline h-4 w-4" /> لا توجد في هذا الإصدار صلاحية لإنشاء إعلان أو دفع أو إرسال تسويقي، حتى بعد الاعتماد.</div></CardContent></Card>

          <Card className="border-stone-200/90 shadow-sm"><CardHeader><div className="flex items-center gap-2"><Tags className="h-4 w-4 text-emerald-700" /><CardTitle className="text-base">سجل الحملة</CardTitle></div></CardHeader><CardContent>{selected.activities.length === 0 ? <p className="text-sm text-muted-foreground">لا يوجد نشاط مسجل بعد.</p> : <div className="space-y-3 border-r border-stone-200 pr-4">{selected.activities.map(activity => <div key={activity.id} className="relative"><span className="absolute -right-[21px] top-1 h-3 w-3 rounded-full border-2 border-white bg-emerald-600" /><p className="text-sm font-medium">{activity.action === "approval_requested" ? "طُلب اعتماد الحملة" : activity.action === "approved" ? "اعتُمِدت الحملة داخلياً" : activity.action === "changes_requested" ? "طُلب تعديل الحملة" : activity.action === "budget_updated" ? "تغيرت الميزانية التخطيطية" : activity.action === "content_linked" ? "تغير محتوى الحملة" : activity.action === "archived" ? "أُرشفت الحملة" : activity.action === "created" ? "أُنشئت الحملة" : "عُدلت الحملة"}</p>{activity.note ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{activity.note}</p> : null}<p className="mt-1 text-[11px] text-muted-foreground">{new Date(activity.createdAt).toLocaleString("ar-IQ")}</p></div>)}</div>}</CardContent></Card>
        </div>}
      </div>
    </div>
  );
}
