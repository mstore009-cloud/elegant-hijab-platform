import { AlertTriangle, Banknote, History, LockKeyhole, PencilLine, Search, ShieldCheck, TrendingUp, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

function iqNumber(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: string | null | undefined) {
  const amount = iqNumber(value);
  if (amount === null) return "غير مسجلة";
  return `${new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 2 }).format(amount)} د.ع`;
}

function percent(value: string | null | undefined) {
  const amount = iqNumber(value);
  return amount === null ? "غير محدد" : `${new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 2 }).format(amount)}٪`;
}

function actualMargin(sellingPrice: string, costPrice: string | null) {
  const selling = iqNumber(sellingPrice);
  const cost = iqNumber(costPrice);
  if (selling === null || cost === null || selling <= 0) return null;
  return ((selling - cost) / selling) * 100;
}

function dateTime(value: Date | string) {
  return new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function Financials() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [costPrice, setCostPrice] = useState("");
  const [targetMargin, setTargetMargin] = useState("");
  const [reason, setReason] = useState("");
  const productsQuery = trpc.financials.listProducts.useQuery(undefined, { retry: false });
  const detailQuery = trpc.financials.byProduct.useQuery({ productId: selectedProductId ?? 0 }, { enabled: selectedProductId !== null, retry: false });
  const updateMutation = trpc.financials.updateProduct.useMutation({
    onSuccess: async () => {
      toast.success("حُفظت بيانات التكلفة في سجلها الخاص.");
      setReason("");
      await Promise.all([utils.financials.listProducts.invalidate(), utils.financials.byProduct.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  useEffect(() => {
    if (!detailQuery.data?.product) return;
    setCostPrice(detailQuery.data.product.costPrice ?? "");
    setTargetMargin(detailQuery.data.product.targetMarginPercent ?? "");
  }, [detailQuery.data?.product?.id, detailQuery.data?.product?.costPrice, detailQuery.data?.product?.targetMarginPercent]);

  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return productsQuery.data ?? [];
    return (productsQuery.data ?? []).filter(item => `${item.name} ${item.productCode} ${item.category ?? ""}`.toLowerCase().includes(needle));
  }, [productsQuery.data, search]);

  const summary = useMemo(() => {
    const all = productsQuery.data ?? [];
    const withCost = all.filter(item => iqNumber(item.costPrice) !== null);
    const margins = withCost.map(item => actualMargin(item.sellingPrice, item.costPrice)).filter((value): value is number => value !== null);
    const totalGrossProfit = withCost.reduce((total, item) => total + Math.max(0, (iqNumber(item.sellingPrice) ?? 0) - (iqNumber(item.costPrice) ?? 0)), 0);
    return { total: all.length, withCost: withCost.length, avgMargin: margins.length ? margins.reduce((sum, value) => sum + value, 0) / margins.length : null, totalGrossProfit };
  }, [productsQuery.data]);

  const product = detailQuery.data?.product;
  const handleSave = () => {
    if (!selectedProductId || !product) return;
    if (reason.trim().length < 3) {
      toast.error("اكتب سبباً واضحاً للتعديل لا يقل عن 3 أحرف.");
      return;
    }
    const normalizedCost = costPrice.trim();
    const normalizedTarget = targetMargin.trim();
    updateMutation.mutate({
      productId: selectedProductId,
      costPrice: normalizedCost.length ? normalizedCost : null,
      targetMarginPercent: normalizedTarget.length ? normalizedTarget : null,
      reason: reason.trim(),
    });
  };

  if (productsQuery.error?.data?.code === "FORBIDDEN") {
    return <AccessDenied message="هذه الصفحة محجوبة لأن بيانات التكلفة والهامش لا تُتاح إلا لمن يحمل تصريحاً مالياً صريحاً." />;
  }

  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-5 pb-10">
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="border-b bg-gradient-to-l from-primary/10 via-background to-amber-50/60 px-5 py-6 sm:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl space-y-2">
              <div className="flex items-center gap-2 text-primary"><LockKeyhole className="h-4 w-4" /><span className="text-sm font-semibold">مساحة مالية خاصة</span></div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">التكلفة والهامش</h1>
              <p className="text-sm leading-6 text-muted-foreground">تُعرض هنا فقط تكلفة المنتج والهامش المستهدف وسجل تعديلهما. لا تصل هذه البيانات إلى المتجر العام أو العميل أو قائمة المنتجات التشغيلية المعتادة.</p>
            </div>
            <Badge variant="outline" className="h-fit w-fit border-primary/25 bg-background/80 px-3 py-1.5 text-primary"><ShieldCheck className="ml-1.5 h-3.5 w-3.5" />سجل تدقيقي مفعّل</Badge>
          </div>
        </div>
        <CardContent className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4 sm:p-6">
          <Metric icon={WalletCards} label="إجمالي المنتجات" value={String(summary.total)} muted="ضمن المتجر الحالي" />
          <Metric icon={Banknote} label="تكلفة مسجلة" value={`${summary.withCost} / ${summary.total}`} muted="منتجات لها تكلفة" />
          <Metric icon={TrendingUp} label="متوسط الهامش الفعلي" value={summary.avgMargin === null ? "غير متاح" : `${summary.avgMargin.toFixed(1)}٪`} muted="من المنتجات المسجلة" />
          <Metric icon={PencilLine} label="هامش إجمالي تقديري" value={summary.totalGrossProfit ? money(String(summary.totalGrossProfit)) : "غير متاح"} muted="ليس إيراداً أو ربحاً محاسبياً" />
        </CardContent>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card className="min-w-0">
          <CardHeader className="space-y-3 border-b">
            <div className="flex items-center justify-between gap-3"><div><CardTitle className="text-lg">المنتجات الخاصة</CardTitle><CardDescription>اختر منتجاً لعرض وتعديل سجله المالي.</CardDescription></div><Badge variant="secondary">{filteredProducts.length}</Badge></div>
            <div className="relative"><Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" /><Input className="pr-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو الرمز أو التصنيف" /></div>
          </CardHeader>
          <CardContent className="max-h-[620px] space-y-2 overflow-y-auto p-3">
            {productsQuery.isLoading ? Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />) : null}
            {productsQuery.error ? <InlineError message="تعذر تحميل قائمة المنتجات المالية. أعد المحاولة." /> : null}
            {!productsQuery.isLoading && !productsQuery.error && filteredProducts.length === 0 ? <EmptyProducts /> : null}
            {filteredProducts.map(item => {
              const selected = item.id === selectedProductId;
              const currentMargin = actualMargin(item.sellingPrice, item.costPrice);
              return <button key={item.id} type="button" onClick={() => setSelectedProductId(item.id)} className={`w-full rounded-xl border p-3 text-right transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary bg-primary/5" : "hover:border-primary/35 hover:bg-muted/35"}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{item.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.productCode}{item.category ? ` · ${item.category}` : ""}</p></div><Badge variant={item.status === "active" ? "default" : "secondary"} className="shrink-0">{item.status === "active" ? "نشط" : item.status === "archived" ? "مؤرشف" : "داخلي"}</Badge></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-muted/55 p-2"><span className="block text-muted-foreground">تكلفة</span><strong className="mt-0.5 block text-foreground">{money(item.costPrice)}</strong></div><div className="rounded-lg bg-muted/55 p-2"><span className="block text-muted-foreground">هامش فعلي</span><strong className="mt-0.5 block text-foreground">{currentMargin === null ? "غير متاح" : `${currentMargin.toFixed(1)}٪`}</strong></div></div>
              </button>;
            })}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          {!selectedProductId ? <SelectPrompt /> : null}
          {selectedProductId && detailQuery.isLoading ? <div className="space-y-4 p-6"><Skeleton className="h-8 w-2/5" /><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div> : null}
          {selectedProductId && detailQuery.error ? <div className="p-6"><InlineError message={detailQuery.error.message || "تعذر قراءة السجل المالي لهذا المنتج."} /></div> : null}
          {product ? <>
            <CardHeader className="border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-xl">{product.name}</CardTitle><CardDescription className="mt-1">{product.productCode}{product.category ? ` · ${product.category}` : ""}</CardDescription></div><Badge variant="outline">سعر البيع: {money(product.sellingPrice)}</Badge></div></CardHeader>
            <CardContent className="space-y-6 p-5 sm:p-6">
              <div className="grid gap-3 sm:grid-cols-3"><Value label="التكلفة الحالية" value={money(product.costPrice)} /><Value label="الهامش الفعلي" value={actualMargin(product.sellingPrice, product.costPrice) === null ? "غير متاح" : `${actualMargin(product.sellingPrice, product.costPrice)!.toFixed(1)}٪`} /><Value label="الهامش المستهدف" value={percent(product.targetMarginPercent)} /></div>
              <div className="rounded-xl border bg-amber-50/45 p-4 text-sm leading-6 text-amber-900"><AlertTriangle className="ml-2 inline h-4 w-4" />لا يغير هذا النموذج سعر البيع أو القسائم أو الطلبات. يُسجل كل تعديل مع سببه داخل سجل مالي خاص.</div>
              <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="cost-price">تكلفة المنتج</Label><Input id="cost-price" inputMode="decimal" value={costPrice} onChange={event => setCostPrice(event.target.value)} placeholder="مثال: 12000" /><p className="text-xs text-muted-foreground">اتركه فارغاً لإزالة القيمة المسجلة.</p></div><div className="space-y-2"><Label htmlFor="target-margin">الهامش المستهدف ٪</Label><Input id="target-margin" inputMode="decimal" value={targetMargin} onChange={event => setTargetMargin(event.target.value)} placeholder="مثال: 35" /><p className="text-xs text-muted-foreground">مؤشر داخلي فقط، وليس خصماً للعميلة.</p></div></div>
              <div className="space-y-2"><Label htmlFor="financial-reason">سبب التعديل</Label><Textarea id="financial-reason" value={reason} onChange={event => setReason(event.target.value)} placeholder="مثال: تحديث سعر المورد المعتمد" maxLength={360} /><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{reason.length}/360</span><Button onClick={handleSave} disabled={updateMutation.isPending}>{updateMutation.isPending ? "جارٍ الحفظ…" : "حفظ التعديل في السجل"}</Button></div></div>
              <section className="space-y-3 border-t pt-5"><div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h2 className="font-semibold">سجل التعديلات</h2></div>{detailQuery.data?.changes.length ? <div className="space-y-2">{detailQuery.data.changes.map(change => <div key={change.id} className="rounded-xl border bg-muted/25 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{change.reason}</strong><span className="text-xs text-muted-foreground">{dateTime(change.createdAt)}</span></div><div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2"><span>التكلفة: {money(change.priorCostPrice)} ← {money(change.nextCostPrice)}</span><span>الهامش: {percent(change.priorTargetMarginPercent)} ← {percent(change.nextTargetMarginPercent)}</span></div></div>)}</div> : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">لا توجد تعديلات سابقة لهذا المنتج.</p>}</section>
            </CardContent>
          </> : null}
        </Card>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, muted }: { icon: typeof Banknote; label: string; value: string; muted: string }) {
  return <div className="rounded-xl border bg-background/75 p-4"><Icon className="h-4 w-4 text-primary" /><p className="mt-3 text-xs text-muted-foreground">{label}</p><p className="mt-1 truncate text-lg font-bold">{value}</p><p className="mt-1 text-[11px] text-muted-foreground">{muted}</p></div>;
}

function Value({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-muted/25 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}

function InlineError({ message }: { message: string }) {
  return <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"><AlertTriangle className="ml-2 inline h-4 w-4" />{message}</div>;
}

function EmptyProducts() {
  return <div className="rounded-xl border border-dashed p-8 text-center"><WalletCards className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-3 font-semibold">لا توجد منتجات مطابقة</p><p className="mt-1 text-sm text-muted-foreground">غيّر عبارة البحث أو أضف منتجاً من قسم المنتجات.</p></div>;
}

function SelectPrompt() {
  return <div className="flex min-h-[460px] flex-col items-center justify-center p-8 text-center"><LockKeyhole className="h-9 w-9 text-primary" /><h2 className="mt-4 text-lg font-bold">اختر منتجاً خاصاً</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">تظهر بيانات التكلفة وسجل تغييرها فقط داخل هذه المساحة المحمية بعد اختيار المنتج.</p></div>;
}

function AccessDenied({ message }: { message: string }) {
  return <div dir="rtl" className="mx-auto flex min-h-[58vh] max-w-xl flex-col items-center justify-center p-6 text-center"><LockKeyhole className="h-10 w-10 text-primary" /><h1 className="mt-4 text-2xl font-bold">بيانات مالية محمية</h1><p className="mt-2 leading-7 text-muted-foreground">{message}</p></div>;
}
