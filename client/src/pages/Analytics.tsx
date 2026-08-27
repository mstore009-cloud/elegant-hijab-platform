import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { AlertCircle, BarChart3, CalendarDays, CheckCircle2, ClipboardList, Clock3, FileText, LineChart, Loader2, MessageCircleMore, ReceiptText, TrendingDown, TrendingUp, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";

const orderStatusLabels: Record<string, string> = {
  new: "جديدة",
  needs_contact: "تحتاج تواصلاً",
  confirmed: "مؤكدة",
  preparing: "قيد التجهيز",
  out_for_delivery: "خرجت للتوصيل",
  completed: "مكتملة",
  cancelled: "ملغاة",
};

const contentStatusLabels: Record<string, string> = {
  draft: "مسودة",
  needs_review: "بانتظار المراجعة",
  approved: "معتمدة",
  changes_requested: "تحتاج تعديلاً",
  archived: "مؤرشفة",
};

const marketingStatusLabels: Record<string, string> = {
  draft: "مسودة",
  needs_approval: "بانتظار الاعتماد",
  approved: "معتمدة داخلياً",
  changes_requested: "تحتاج تعديلاً",
  archived: "مؤرشفة",
};

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function initialRange(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return { startDate: isoDay(start), endDate: isoDay(end) };
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("ar-IQ", { maximumFractionDigits: 0 }).format(value) + " " + currency;
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("ar-IQ", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${value}T12:00:00.000Z`));
}

function ChangeValue({ value }: { value: { change: number; changePercent: number | null } }) {
  if (value.changePercent === null) return <span className="text-[11px] text-muted-foreground">لا توجد فترة مقارنة كافية</span>;
  const positive = value.changePercent >= 0;
  return <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${positive ? "text-emerald-700" : "text-rose-700"}`}>{positive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{Math.abs(value.changePercent).toLocaleString("ar-IQ")}٪ مقارنة بالفترة السابقة</span>;
}

function MetricCard({ label, value, note, icon: Icon, tone, comparison }: { label: string; value: string; note?: string; icon: typeof ReceiptText; tone: string; comparison?: { change: number; changePercent: number | null } }) {
  return <Card className="border-stone-200/90 shadow-sm"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1.5 truncate text-xl font-bold tracking-tight text-foreground">{value}</p></div><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl ${tone}`}><Icon className="h-5 w-5" /></span></div><div className="mt-3 min-h-4">{comparison ? <ChangeValue value={comparison} /> : note ? <p className="text-[11px] leading-4 text-muted-foreground">{note}</p> : null}</div></CardContent></Card>;
}

function StatusRows({ title, entries, labels, tone = "bg-emerald-600" }: { title: string; entries: Record<string, number>; labels: Record<string, string>; tone?: string }) {
  const total = Object.values(entries).reduce((sum, value) => sum + value, 0);
  return <Card className="border-stone-200/90 shadow-sm"><CardHeader className="pb-3"><CardTitle className="text-base">{title}</CardTitle></CardHeader><CardContent className="space-y-3">{Object.entries(entries).map(([status, count]) => <div key={status} className="space-y-1.5"><div className="flex justify-between text-xs"><span>{labels[status] ?? status}</span><span className="font-semibold tabular-nums">{count.toLocaleString("ar-IQ")}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-stone-100"><div className={`h-full rounded-full ${tone}`} style={{ width: `${total ? (count / total) * 100 : 0}%` }} /></div></div>)}</CardContent></Card>;
}

export default function Analytics() {
  const [range, setRange] = useState(() => initialRange(30));
  const queryInput = useMemo(() => range, [range.startDate, range.endDate]);
  const overview = trpc.analytics.overview.useQuery(queryInput);
  const data = overview.data;
  const dailyMaximum = Math.max(...(data?.orders.daily.map(item => item.total) ?? []), 1);

  const chooseRange = (days: number) => setRange(initialRange(days));

  return <div dir="rtl" className="mx-auto max-w-[1540px] space-y-5 pb-10">
    <section className="relative overflow-hidden rounded-3xl bg-[linear-gradient(115deg,#123e34,#1c5a49)] px-6 py-7 text-white shadow-[0_18px_45px_-24px_rgba(13,64,52,.9)] sm:px-8">
      <span className="pointer-events-none absolute -left-12 -top-16 h-44 w-44 rounded-full border border-[#d9bb71]/25" />
      <div className="relative flex flex-col justify-between gap-5 xl:flex-row xl:items-end"><div className="max-w-2xl"><div className="mb-3 flex items-center gap-2 text-xs text-emerald-100"><BarChart3 className="h-4 w-4" /> قراءة تشغيلية من بيانات المتجر الفعلية</div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">التحليلات التشغيلية</h1><p className="mt-2 text-sm leading-6 text-emerald-50/85">راقبي الطلبات والعملاء وInbox والمحتوى والتخطيط من مصدر واحد. لا تعرض هذه اللوحة زيارات أو أداء إعلان أو قناة غير موصولة.</p></div><div className="rounded-2xl border border-white/15 bg-white/[0.08] p-3 backdrop-blur-sm"><div className="flex flex-wrap items-center gap-2"><CalendarDays className="h-4 w-4 text-[#e9cf8b]" /><Input aria-label="بداية الفترة" type="date" value={range.startDate} onChange={event => setRange(current => ({ ...current, startDate: event.target.value }))} className="h-9 w-[145px] border-white/20 bg-white/10 text-xs text-white [color-scheme:dark]" /><span className="text-xs text-emerald-100">إلى</span><Input aria-label="نهاية الفترة" type="date" value={range.endDate} onChange={event => setRange(current => ({ ...current, endDate: event.target.value }))} className="h-9 w-[145px] border-white/20 bg-white/10 text-xs text-white [color-scheme:dark]" /></div><div className="mt-2 flex gap-2">{[7, 30, 90].map(days => <Button key={days} variant="ghost" size="sm" onClick={() => chooseRange(days)} className="h-7 px-2 text-xs text-emerald-50 hover:bg-white/10 hover:text-white">آخر {days.toLocaleString("ar-IQ")} يوماً</Button>)}</div></div></div>
    </section>

    {overview.isLoading ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Card key={index} className="h-32 animate-pulse border-stone-200 bg-stone-50" />)}</div> : overview.error ? <Card className="border-rose-200 bg-rose-50"><CardContent className="flex gap-3 p-5 text-sm text-rose-800"><AlertCircle className="h-5 w-5 shrink-0" /><div><p className="font-semibold">تعذر تحميل التحليلات</p><p className="mt-1">{overview.error.message}</p></div></CardContent></Card> : !data ? null : <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="إجمالي قيمة الطلبات" value={money(data.orders.total, data.currencyCode)} icon={ReceiptText} tone="bg-emerald-50 text-emerald-700" comparison={data.orders.totalComparison} /><MetricCard label="الطلبات المسجلة" value={data.orders.count.toLocaleString("ar-IQ")} icon={ClipboardList} tone="bg-sky-50 text-sky-700" comparison={data.orders.countComparison} /><MetricCard label="متوسط قيمة الطلب" value={money(data.orders.averageOrderValue, data.currencyCode)} icon={LineChart} tone="bg-amber-50 text-amber-700" note="يحسب من إجمالي الطلبات داخل الفترة" /><MetricCard label="العميلات المتكررات" value={data.customers.repeatProfiles.toLocaleString("ar-IQ")} icon={UsersRound} tone="bg-violet-50 text-violet-700" note={`من أصل ${data.customers.totalProfiles.toLocaleString("ar-IQ")} ملف عميلة`} /></section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr),minmax(280px,.55fr)]"><Card className="border-stone-200/90 shadow-sm"><CardHeader className="flex flex-row items-start justify-between gap-4 pb-3"><div><CardTitle className="text-base">قيمة الطلبات اليومية</CardTitle><p className="mt-1 text-xs text-muted-foreground">القيمة محفوظة من لقطة الطلب عند إنشائه، لا من سعر المنتج الحالي.</p></div><Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">{range.startDate} — {range.endDate}</Badge></CardHeader><CardContent>{data.orders.count === 0 ? <div className="flex h-60 flex-col items-center justify-center text-center"><LineChart className="h-7 w-7 text-stone-300" /><p className="mt-3 text-sm font-medium">لا توجد طلبات داخل الفترة المختارة</p><p className="mt-1 text-xs text-muted-foreground">لن نرسم قيماً بديلة أو تقديرات عند غياب البيانات.</p></div> : <div><div className="flex h-52 items-end gap-1.5 border-b border-stone-200 pb-1">{data.orders.daily.map((item, index) => <div key={item.date} className="group relative flex h-full min-w-0 flex-1 items-end"><div title={`${shortDate(item.date)}: ${money(item.total, data.currencyCode)}`} className="w-full rounded-t-md bg-emerald-600/85 transition-colors hover:bg-[#d0ad5d]" style={{ height: `${Math.max((item.total / dailyMaximum) * 100, item.total ? 4 : 0)}%` }} /><div className="pointer-events-none absolute bottom-full right-1/2 z-10 mb-2 hidden w-max -translate-x-1/2 rounded-lg bg-stone-900 px-2 py-1 text-[10px] text-white shadow-lg group-hover:block">{shortDate(item.date)} · {money(item.total, data.currencyCode)}</div>{(index === 0 || index === data.orders.daily.length - 1 || data.orders.daily.length <= 8) && <span className="absolute -bottom-5 right-1/2 max-w-16 -translate-x-1/2 truncate text-[9px] text-muted-foreground">{shortDate(item.date)}</span>}</div>)}</div><div className="mt-8 flex items-center justify-between text-xs text-muted-foreground"><span>عدد الطلبات: {data.orders.count.toLocaleString("ar-IQ")}</span><span>أعلى يوم: {money(dailyMaximum, data.currencyCode)}</span></div></div>}</CardContent></Card><StatusRows title="حالة الطلبات" entries={data.orders.statusCounts} labels={orderStatusLabels} /></section>

      <section className="grid gap-5 lg:grid-cols-3"><Card className="border-stone-200/90 shadow-sm"><CardHeader className="pb-3"><div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-emerald-700" /><CardTitle className="text-base">نبض العملاء</CardTitle></div></CardHeader><CardContent className="space-y-3"><div className="flex items-center justify-between rounded-xl bg-stone-50 p-3"><span className="text-sm">ملفات جديدة في الفترة</span><b>{data.customers.newProfiles.toLocaleString("ar-IQ")}</b></div><div className="flex items-center justify-between rounded-xl bg-stone-50 p-3"><span className="text-sm">مهام متابعة مفتوحة</span><b>{data.customers.openTasks.toLocaleString("ar-IQ")}</b></div><div className={`flex items-center justify-between rounded-xl p-3 ${data.customers.overdueTasks ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}`}><span className="flex items-center gap-2 text-sm"><Clock3 className="h-4 w-4" /> مهام متأخرة</span><b>{data.customers.overdueTasks.toLocaleString("ar-IQ")}</b></div></CardContent></Card><Card className="border-stone-200/90 shadow-sm"><CardHeader className="pb-3"><div className="flex items-center gap-2"><MessageCircleMore className="h-4 w-4 text-emerald-700" /><CardTitle className="text-base">Inbox التشغيلي</CardTitle></div></CardHeader><CardContent className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-stone-50 p-3"><p className="text-xs text-muted-foreground">مفتوحة</p><p className="mt-1 text-xl font-bold">{data.inbox.open.toLocaleString("ar-IQ")}</p></div><div className="rounded-xl bg-stone-50 p-3"><p className="text-xs text-muted-foreground">بانتظار العميل</p><p className="mt-1 text-xl font-bold">{data.inbox.waitingCustomer.toLocaleString("ar-IQ")}</p></div><div className="rounded-xl bg-stone-50 p-3"><p className="text-xs text-muted-foreground">غير معيّنة</p><p className="mt-1 text-xl font-bold">{data.inbox.unassigned.toLocaleString("ar-IQ")}</p></div><div className="rounded-xl bg-stone-50 p-3"><p className="text-xs text-muted-foreground">مؤجلة</p><p className="mt-1 text-xl font-bold">{data.inbox.snoozed.toLocaleString("ar-IQ")}</p></div></CardContent></Card><StatusRows title="حالة المحتوى" entries={data.content.statusCounts} labels={contentStatusLabels} tone="bg-[#d0ad5d]" /></section>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr),minmax(310px,.7fr)]"><Card className="border-stone-200/90 shadow-sm"><CardHeader className="pb-3"><div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-700" /><CardTitle className="text-base">التخطيط التسويقي الداخلي</CardTitle></div><p className="text-xs text-muted-foreground">المبالغ أدناه ميزانيات تخطيطية فقط، ولا تمثل دفعاً أو إنفاقاً فعلياً.</p></CardHeader><CardContent className="grid gap-4 md:grid-cols-[1fr,.9fr]"><StatusRows title="حالة الحملات" entries={data.marketing.statusCounts} labels={marketingStatusLabels} tone="bg-sky-600" /><div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4"><p className="text-sm font-semibold">إجمالي الميزانيات التخطيطية</p><div className="mt-3 space-y-2">{data.marketing.plannedBudgets.length ? data.marketing.plannedBudgets.map(item => <div key={item.currencyCode} className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm shadow-sm"><span>{item.currencyCode}</span><b>{money(item.total, item.currencyCode)}</b></div>) : <p className="text-sm leading-6 text-muted-foreground">لا توجد ميزانية تخطيطية محفوظة للحملات غير المؤرشفة.</p>}</div></div></CardContent></Card>
        <Card className="border-amber-200 bg-amber-50/50 shadow-sm"><CardHeader className="pb-3"><div className="flex items-center gap-2 text-amber-900"><AlertCircle className="h-4 w-4" /><CardTitle className="text-base">مصادر لم تُربط بعد</CardTitle></div><p className="text-xs leading-5 text-amber-800/80">هذه المؤشرات لا تظهر بقيمة صفر لأنها غير مسجلة في المنصة حتى الآن.</p></CardHeader><CardContent className="space-y-2">{data.unavailableMetrics.map(metric => <div key={metric} className="rounded-xl border border-amber-200/80 bg-white/70 px-3 py-2 text-sm text-amber-950">{metric}<span className="mr-2 text-xs text-amber-700">يتطلب ربط مصدر رسمي</span></div>)}</CardContent></Card>
      </section>
    </>}
  </div>;
}
