import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Archive, Bell, BellRing, CheckCheck, CircleAlert, ExternalLink, Inbox, Loader2, Settings2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

type NotificationFilter = "all" | "unread" | "read" | "archived";

const filters: Array<{ value: NotificationFilter; label: string }> = [
  { value: "unread", label: "غير المقروءة" },
  { value: "all", label: "النشطة" },
  { value: "read", label: "المقروءة" },
  { value: "archived", label: "المؤرشفة" },
];

const typeLabel: Record<string, string> = {
  inbox_assigned: "تعيين محادثة",
  bot_handoff: "تحويل من البوت",
  crm_task_assigned: "مهمة عميل",
  content_review_requested: "مراجعة محتوى",
  marketing_approval_requested: "اعتماد حملة",
  loyalty_reward_review_requested: "اعتماد مكافأة",
  order_created: "طلب جديد",
};

function timestamp(value: Date | string) {
  return new Date(value).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" });
}

export default function Notifications() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<NotificationFilter>("unread");
  const [showSettings, setShowSettings] = useState(false);
  const { data: alerts = [], isLoading, error } = trpc.notifications.listMine.useQuery({ filter, limit: 100 });
  const { data: summary } = trpc.notifications.summary.useQuery();
  const { data: preferences, isLoading: loadingPreferences } = trpc.notifications.preferences.useQuery(undefined, { enabled: showSettings });
  const markRead = trpc.notifications.markRead.useMutation({ onSuccess: () => { void utils.notifications.listMine.invalidate(); void utils.notifications.summary.invalidate(); } });
  const archive = trpc.notifications.archive.useMutation({ onSuccess: () => { void utils.notifications.listMine.invalidate(); void utils.notifications.summary.invalidate(); toast.success("أُرشف التنبيه من مركزك."); }, onError: item => toast.error(item.message) });
  const savePreferences = trpc.notifications.savePreferences.useMutation({ onSuccess: () => { void utils.notifications.preferences.invalidate(); toast.success("حُفظت تفضيلات التنبيهات الداخلية."); }, onError: item => toast.error(item.message) });
  const unreadCount = summary?.unreadCount ?? 0;
  const preferenceItems = useMemo(() => [
    { key: "inboxAssignments" as const, label: "تعيين المحادثات", help: "عند إسناد محادثة Inbox إليك." },
    { key: "botHandoffs" as const, label: "تحويلات البوت", help: "عندما يحتاج البوت إلى تدخل بشري." },
    { key: "crmTasks" as const, label: "مهام العملاء", help: "عند إسناد مهمة متابعة لك." },
    { key: "reviewRequests" as const, label: "طلبات المراجعة", help: "لمراجعة محتوى أو حملة أو مكافأة داخلية." },
    { key: "orderUpdates" as const, label: "الطلبات الجديدة", help: "عند وصول طلب يحتاج إلى تأكيد." },
  ], []);

  const openSource = async (item: typeof alerts[number]) => {
    if (!item.readAt) await markRead.mutateAsync({ notificationId: item.id });
    setLocation(item.route);
  };

  if (error) return <Card className="mx-auto max-w-4xl border-destructive/30" dir="rtl"><CardHeader><CardTitle className="text-destructive">تعذر فتح مركز التنبيهات</CardTitle><CardDescription>{error.message}</CardDescription></CardHeader></Card>;

  return <div dir="rtl" className="mx-auto max-w-6xl space-y-5 pb-12">
    <section className="rounded-3xl border bg-card p-5 shadow-sm md:p-7">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div className="flex gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BellRing className="h-6 w-6" /></div><div><p className="text-sm font-medium text-primary">تنبيهات العمل</p><h1 className="mt-1 text-2xl font-bold tracking-tight">مركز التنبيهات الداخلي</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">متابعة التعيينات وطلبات المراجعة والعمل الذي يحتاج تدخلك. لا يرسل هذا المركز بريداً أو WhatsApp أو إشعاراً خارج المنصة.</p></div></div>
        <div className="flex items-center gap-3 rounded-2xl bg-muted/50 px-4 py-3"><Bell className="h-5 w-5 text-primary" /><div><p className="text-xl font-bold leading-none">{unreadCount}</p><p className="mt-1 text-xs text-muted-foreground">غير مقروء</p></div><Button variant="outline" size="sm" onClick={() => setShowSettings(value => !value)}><Settings2 className="ml-1.5 h-4 w-4" />التفضيلات</Button></div>
      </div>
    </section>

    {showSettings ? <Card><CardHeader><CardTitle className="text-base">تفضيلات مركزك</CardTitle><CardDescription>تؤثر هذه الخيارات في التنبيهات التي تظهر لك داخل المنصة فقط، ولا تغيّر مصدر العمل أو ترسل أي رسالة خارجية.</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{loadingPreferences || !preferences ? <div className="col-span-full flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />يجري تحميل التفضيلات…</div> : preferenceItems.map(item => <div key={item.key} className="flex items-center justify-between rounded-xl border p-3"><div><p className="text-sm font-medium">{item.label}</p><p className="mt-1 text-xs text-muted-foreground">{item.help}</p></div><Switch checked={preferences[item.key]} disabled={savePreferences.isPending} onCheckedChange={checked => savePreferences.mutate({ ...preferences, [item.key]: checked })} /></div>)}</CardContent></Card> : null}

    <Card><CardHeader className="gap-4"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-center"><div><CardTitle>صندوق العمل</CardTitle><CardDescription className="mt-1">افتحي مصدر التنبيه للمتابعة، أو أرشفيه لإزالته من قائمتك.</CardDescription></div><div className="flex flex-wrap gap-2">{filters.map(option => <Button key={option.value} variant={filter === option.value ? "default" : "outline"} size="sm" onClick={() => setFilter(option.value)}>{option.label}</Button>)}</div></div></CardHeader><CardContent className="space-y-3">{isLoading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />يجري تحميل تنبيهاتك…</div> : alerts.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center text-center"><Inbox className="mb-3 h-9 w-9 text-muted-foreground/60" /><p className="font-medium">لا توجد تنبيهات في هذه القائمة</p><p className="mt-1 text-sm text-muted-foreground">تظهر هنا أحداث العمل الموجهة إليك داخل المتجر الحالي.</p></div> : alerts.map(item => <article key={item.id} className={`flex flex-col gap-3 rounded-2xl border p-4 transition-colors md:flex-row md:items-center md:justify-between ${item.readAt ? "bg-background" : "border-primary/30 bg-primary/[0.035]"}`}><div className="flex min-w-0 gap-3"><div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.priority === "urgent" ? "bg-destructive/10 text-destructive" : item.priority === "action" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}><CircleAlert className="h-4 w-4" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{item.title}</p><Badge variant="secondary" className="text-[11px]">{typeLabel[item.type] ?? item.type}</Badge>{!item.readAt ? <span className="h-2 w-2 rounded-full bg-primary" aria-label="غير مقروء" /> : null}</div>{item.body ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{item.body}</p> : null}<p className="mt-2 text-xs text-muted-foreground">{timestamp(item.createdAt)}</p></div></div><div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" disabled={markRead.isPending} onClick={() => void openSource(item)}><ExternalLink className="ml-1.5 h-4 w-4" />فتح المصدر</Button><Button variant="ghost" size="icon" disabled={archive.isPending} onClick={() => archive.mutate({ notificationId: item.id })} aria-label="أرشفة التنبيه"><Archive className="h-4 w-4" /></Button></div></article>)}</CardContent></Card>

    <p className="flex items-center gap-2 px-1 text-xs leading-5 text-muted-foreground"><CheckCheck className="h-3.5 w-3.5" />حالة القراءة والأرشفة خاصة بحسابك. أرشفة التنبيه لا تحذف المحادثة أو المهمة أو المسودة أو الطلب المرتبط به.</p>
  </div>;
}
