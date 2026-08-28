import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, BarChart3, Boxes, Cable, CheckCircle2, ExternalLink, FileImage, LoaderCircle, Megaphone, MessageCircleMore, RefreshCw, ShieldCheck, Unplug, UsersRound } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

type Purpose = "messaging" | "content" | "ads_read" | "leads" | "catalog" | "measurement";
const purposeMeta: Record<Purpose, { title: string; description: string; icon: typeof Cable }> = {
  messaging: { title: "الرسائل والقنوات", description: "WhatsApp وMessenger وInstagram Direct والأصول المرتبطة.", icon: MessageCircleMore },
  content: { title: "المحتوى والتفاعل", description: "منشورات Facebook وInstagram والتعليقات والـmentions.", icon: FileImage },
  ads_read: { title: "الإعلانات — قراءة", description: "الحملات والنتائج والإنفاق دون إنشاء أو تعديل.", icon: BarChart3 },
  leads: { title: "عملاء Lead Ads", description: "نماذج العملاء المحتملين وربطها بـCRM.", icon: UsersRound },
  catalog: { title: "Meta Catalog", description: "مزامنة المنتجات النشطة من منصتنا إلى Meta.", icon: Boxes },
  measurement: { title: "القياس والتحويلات", description: "Pixel وConversions API بعد سياسة الخصوصية.", icon: Megaphone },
};
const assetLabels: Record<string, string> = { business: "Business Portfolio", page: "Facebook Page", instagram: "Instagram", whatsapp_business: "WhatsApp Business", whatsapp_phone: "رقم WhatsApp", ad_account: "حساب إعلانات", dataset: "Dataset", pixel: "Pixel", catalog: "Catalog" };

export default function MetaConnections() {
  const profile = trpc.access.myProfile.useQuery();
  const canManage = profile.data?.permissions.includes("settings.manage") ?? false;
  const overview = trpc.metaConnections.overview.useQuery(undefined, { enabled: canManage });
  const begin = trpc.metaConnections.beginAuthorization.useMutation({ onSuccess: data => { window.location.assign(data.authorizationUrl); }, onError: error => toast.error(error.message) });
  const refresh = trpc.metaConnections.refreshAssets.useMutation({ onSuccess: async data => { await overview.refetch(); toast.success(`تم تحديث الأصول: ${data.discovered}${data.warnings.length ? " مع تنبيهات تحتاج مراجعة" : ""}.`); }, onError: error => toast.error(error.message) });
  const select = trpc.metaConnections.selectAsset.useMutation({ onSuccess: async () => { await overview.refetch(); toast.success("تم اعتماد الأصل لهذا المتجر ووضع القناة في حالة اختبار."); }, onError: error => toast.error(error.message) });
  const disconnect = trpc.metaConnections.disconnect.useMutation({ onSuccess: async () => { await overview.refetch(); toast.success("تم إبطال الاتصال وحذف الرمز المشفر محلياً."); }, onError: error => toast.error(error.message) });

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("meta");
    if (!result) return;
    if (result === "connected") toast.success("تم تفويض Meta واكتشاف الأصول بنجاح.");
    else if (result === "partial") toast.warning("تم الاتصال، لكن بعض الأصول تحتاج مراجعة الصلاحيات.");
    else toast.error(result === "denied" ? "أُلغي تفويض Meta." : result === "expired" ? "انتهت جلسة الربط. ابدئي من جديد." : "تعذر إكمال اتصال Meta.");
    window.history.replaceState({}, "", "/meta-connections");
  }, []);

  if (profile.isLoading) return <PageSkeleton />;
  if (!canManage) return <Forbidden />;
  if (overview.isLoading) return <PageSkeleton />;
  const data = overview.data;
  const callbackUrl = data?.callbackUrl?.startsWith("/") ? `${window.location.origin}${data.callbackUrl}` : data?.callbackUrl || `${window.location.origin}/api/meta/oauth/callback`;

  return <div dir="rtl" className="mx-auto max-w-6xl space-y-5 pb-10">
    <header className="overflow-hidden rounded-[1.8rem] border border-[#eadfe2] bg-[radial-gradient(circle_at_85%_10%,#f8e8eb,transparent_38%),linear-gradient(135deg,#fffdfc,#f7f1ed)] px-5 py-6 shadow-[0_14px_35px_rgba(82,48,60,0.07)] sm:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-bold tracking-[0.14em] text-primary">META INTEGRATION HUB</p><h1 className="mt-1.5 flex items-center gap-2 text-2xl font-black text-accent"><Cable className="h-6 w-6 text-primary" />مركز اتصال Meta</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">تفويض منفصل لكل غرض، وأصول محددة لكل متجر، ورموز مشفرة لا تظهر في الواجهة أو السجلات.</p></div><Badge className={data?.configured ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}>{data?.configured ? "التطبيق مهيأ" : "ينتظر إعداد تطبيق Meta"}</Badge></div>
    </header>

    {!data?.configured && <Alert className="border-amber-200 bg-amber-50/80 text-amber-950"><AlertTriangle className="h-4 w-4" /><AlertTitle>أكمل إعداد تطبيق Meta أولاً</AlertTitle><AlertDescription>أضف App ID وApp Secret وRedirect URI عبر الأسرار الآمنة. لن يطلب النظام أي رمز وصول داخل نموذج أو محادثة.</AlertDescription></Alert>}

    <Card className="border-border/80 bg-card/95"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />حالة البنية الآمنة</CardTitle><CardDescription>Graph API {data?.graphVersion} · Callback لا يعرض code أو token للواجهة.</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm sm:grid-cols-3"><StatusItem label="تشفير الرموز" value="AES-256-GCM حسب المتجر والغرض" /><StatusItem label="رابط callback" value={callbackUrl} mono /><StatusItem label="الإرسال والنشر" value="غير مفعّل في هذه المرحلة" /></CardContent></Card>

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {(Object.keys(purposeMeta) as Purpose[]).map(purpose => {
        const meta = purposeMeta[purpose]; const Icon = meta.icon;
        const connection = data?.connections.find(item => item.purpose === purpose);
        const assets = data?.assets.filter(item => item.connectionId === connection?.id) ?? [];
        const purposeConfig = data?.purposes.find(item => item.purpose === purpose);
        return <Card key={purpose} className="overflow-hidden border-border/80 bg-card/95 shadow-[0_12px_28px_rgba(82,48,60,0.05)]"><CardHeader className="pb-3"><div className="flex items-start justify-between gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-primary"><Icon className="h-5 w-5" /></span><ConnectionBadge status={connection?.status} /></div><CardTitle className="pt-2 text-base">{meta.title}</CardTitle><CardDescription className="leading-5">{meta.description}</CardDescription></CardHeader><CardContent className="space-y-3">
          <div className="rounded-xl bg-secondary/70 p-3 text-xs leading-5 text-muted-foreground"><p>Configuration: {purposeConfig?.configurationIdConfigured ? "مخصص" : "صلاحيات الغرض"}</p><p>آخر تحقق: {connection?.lastVerifiedAt ? new Date(connection.lastVerifiedAt).toLocaleString("ar-IQ") : "لا يوجد"}</p>{connection?.lastError && <p className="mt-1 text-destructive">{connection.lastError}</p>}</div>
          {assets.length > 0 && <div className="space-y-2">{assets.map(asset => <button type="button" key={asset.id} onClick={() => !asset.isSelected && select.mutate({ connectionId: asset.connectionId, assetId: asset.id })} className={`w-full rounded-xl border p-3 text-right text-xs transition ${asset.isSelected ? "border-primary bg-primary/8" : "border-border bg-background hover:border-primary/50"}`}><span className="flex items-center justify-between gap-2"><span className="font-bold text-foreground">{asset.displayName || asset.externalId}</span>{asset.isSelected && <CheckCircle2 className="h-4 w-4 text-primary" />}</span><span className="mt-1 block text-muted-foreground">{assetLabels[asset.assetType] || asset.assetType}</span></button>)}</div>}
          <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!data?.configured || begin.isPending} onClick={() => begin.mutate({ purpose })} className="rounded-lg"><ExternalLink className="ml-1.5 h-3.5 w-3.5" />{connection ? "إعادة التفويض" : "ربط"}</Button>{connection && <Button size="sm" variant="outline" disabled={refresh.isPending} onClick={() => refresh.mutate({ purpose })} className="rounded-lg"><RefreshCw className="ml-1.5 h-3.5 w-3.5" />تحديث الأصول</Button>}{connection && <Button size="sm" variant="outline" disabled={disconnect.isPending} onClick={() => window.confirm("هل أنت متأكد من إبطال هذا الاتصال؟") && disconnect.mutate({ purpose, confirm: true })} className="rounded-lg border-destructive/30 text-destructive"><Unplug className="ml-1.5 h-3.5 w-3.5" />إبطال</Button>}</div>
        </CardContent></Card>;
      })}
    </section>
  </div>;
}

function ConnectionBadge({ status }: { status?: string }) { const connected = status === "connected"; return <Badge className={connected ? "bg-emerald-50 text-emerald-700" : status === "failed" || status === "expired" ? "bg-rose-50 text-rose-700" : "bg-secondary text-muted-foreground"}>{connected ? "متصل" : status === "failed" ? "يحتاج مراجعة" : status === "expired" ? "منتهي" : status === "revoked" ? "مبطل" : "غير متصل"}</Badge>; }
function StatusItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) { return <div className="rounded-xl border border-border/70 bg-background p-3"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className={`mt-1 break-all text-sm font-semibold text-foreground ${mono ? "font-mono text-xs" : ""}`}>{value}</p></div>; }
function PageSkeleton() { return <div className="mx-auto max-w-6xl space-y-4"><div className="h-36 animate-pulse rounded-[1.8rem] bg-secondary" /><div className="grid gap-4 md:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-72 animate-pulse rounded-2xl bg-secondary" />)}</div></div>; }
function Forbidden() { return <div dir="rtl" className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center rounded-[2rem] border bg-card p-8 text-center"><ShieldCheck className="h-10 w-10 text-primary" /><h1 className="mt-4 text-xl font-bold">لا تملك صلاحية إدارة التكاملات</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">يحتاج مركز Meta إلى تصريح «إدارة الإعدادات والتكاملات» داخل المتجر الحالي.</p></div>; }
