import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Clipboard, EyeOff, KeyRound, LoaderCircle, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function MetaPlatformSettings() {
  const overview = trpc.metaPlatformSettings.overview.useQuery(undefined, { retry: false });
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [businessConfigId, setBusinessConfigId] = useState("");
  const [graphVersion, setGraphVersion] = useState("v26.0");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [oneTimeToken, setOneTimeToken] = useState<string | null>(null);

  useEffect(() => {
    const settings = overview.data?.settings;
    if (!settings) return;
    setAppId(settings.appId || "");
    setBusinessConfigId(settings.businessLoginConfigurationId || "");
    setGraphVersion(settings.graphApiVersion || "v26.0");
    setPublicBaseUrl(settings.publicBaseUrl || "");
    setCapabilities(settings.defaultCapabilities || []);
  }, [overview.data]);

  const save = trpc.metaPlatformSettings.save.useMutation({
    onSuccess: async result => {
      setAppSecret("");
      setOneTimeToken(result.generatedWebhookVerifyToken ?? null);
      await overview.refetch();
      toast.success("تم حفظ إعداد تطبيق Meta بصورة مشفرة.");
    },
    onError: error => toast.error(error.message),
  });
  const test = trpc.metaPlatformSettings.test.useMutation({
    onSuccess: async result => { await overview.refetch(); result.ready ? toast.success("تم التحقق من التطبيق واشتراكات Webhook المركزية.") : toast.warning("بيانات التطبيق صحيحة، وبعض اشتراكات Webhook تحتاج مراجعة."); },
    onError: error => toast.error(error.message),
  });
  const rotate = trpc.metaPlatformSettings.rotateWebhookVerifyToken.useMutation({
    onSuccess: async result => { setOneTimeToken(result.webhookVerifyToken); await overview.refetch(); toast.success("تم تدوير Verify Token. انسخه الآن لأنه لن يظهر مرة أخرى."); },
    onError: error => toast.error(error.message),
  });

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`تم نسخ ${label}.`);
  };

  if (overview.isLoading) return <div className="mx-auto max-w-5xl"><div className="h-72 animate-pulse rounded-[1.8rem] bg-secondary" /></div>;
  if (overview.error) return <div dir="rtl" className="mx-auto max-w-xl rounded-[1.8rem] border border-rose-200 bg-rose-50 p-6 text-rose-900"><h1 className="text-lg font-black">إعداد خاص بمدير المنصة</h1><p className="mt-2 text-sm leading-6">{overview.error.message}</p></div>;
  const data = overview.data!;
  const settings = data.settings;
  const busy = save.isPending || test.isPending || rotate.isPending;
  const capabilityLabels: Record<string, string> = { messaging: "الرسائل والقنوات", content: "المحتوى والتفاعل", ads_read: "الإعلانات والقراءة", leads: "عملاء Lead Ads", catalog: "Meta Catalog", measurement: "القياس والتحويلات" };
  const toggleCapability = (purpose: string) => setCapabilities(current => current.includes(purpose) ? current.filter(item => item !== purpose) : [...current, purpose]);

  return <div dir="rtl" className="mx-auto max-w-5xl space-y-5 pb-12">
    <header className="rounded-[1.8rem] border border-[#eadfe2] bg-[radial-gradient(circle_at_85%_10%,#f8e8eb,transparent_38%),linear-gradient(135deg,#fffdfc,#f7f1ed)] px-5 py-6 shadow-[0_14px_35px_rgba(82,48,60,0.07)] sm:px-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[11px] font-bold tracking-[0.14em] text-primary">PLATFORM META APP</p><h1 className="mt-1.5 flex items-center gap-2 text-2xl font-black text-accent"><KeyRound className="h-6 w-6 text-primary" />إعداد تطبيق Meta</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">إعداد مركزي واحد يدير تسجيل الدخول الموحد وWebhook لكل المتاجر. الأسرار مشفرة ولا تعاد إلى المتصفح بعد حفظها.</p></div><Badge className={settings.status === "verified" ? "bg-emerald-50 text-emerald-700" : settings.status === "needs_attention" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800"}>{settings.status === "verified" ? "متحقق" : settings.status === "ready" ? "جاهز للاختبار" : settings.status === "needs_attention" ? "يحتاج مراجعة" : "غير مكتمل"}</Badge></div>
    </header>

    {oneTimeToken && <Alert className="border-amber-300 bg-amber-50 text-amber-950"><ShieldCheck className="h-4 w-4" /><AlertTitle>Verify Token — يظهر مرة واحدة</AlertTitle><AlertDescription className="mt-2"><div className="flex flex-col gap-2 sm:flex-row sm:items-center"><code className="min-w-0 flex-1 break-all rounded-lg bg-white p-3 text-xs">{oneTimeToken}</code><Button variant="outline" onClick={() => copy(oneTimeToken, "Verify Token")}><Clipboard className="ml-2 h-4 w-4" />نسخ</Button></div></AlertDescription></Alert>}

    <div className="grid gap-5 lg:grid-cols-[1.35fr_.65fr]">
      <Card className="border-border/80 bg-card/95"><CardHeader><CardTitle>بيانات التطبيق المركزي</CardTitle><CardDescription>لا تُدخل Access Token. صاحب المتجر يحصل عليه تلقائياً عبر تسجيل الدخول الرسمي.</CardDescription></CardHeader><CardContent className="space-y-5">
        <Field label="App ID"><Input value={appId} onChange={event => setAppId(event.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="معرّف التطبيق الرقمي" /></Field>
        <Field label="App Secret" hint={settings.appSecretConfigured ? "محفوظ ومشفر — اتركه فارغاً للإبقاء عليه" : "مطلوب عند الحفظ الأول"}><div className="relative"><Input type="password" value={appSecret} onChange={event => setAppSecret(event.target.value)} placeholder={settings.appSecretConfigured ? "••••••••••••••••" : "أدخل App Secret"} className="pl-10" /><EyeOff className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /></div></Field>
        <Field label="Business Login Configuration ID" hint="اختياري لمسار ربط محفظة عميل خارجي فقط؛ لا يستخدم عند ربط محفظة مالك التطبيق"><Input value={businessConfigId} onChange={event => setBusinessConfigId(event.target.value)} placeholder="اختياري للعملاء الخارجيين" /></Field>
        <Field label="النطاق العام للمنصة" hint="يُحفظ داخل المنصة ويولد منه رابط OAuth وWebhook لجميع المتاجر"><Input dir="ltr" value={publicBaseUrl} onChange={event => setPublicBaseUrl(event.target.value)} placeholder="https://example.com" /></Field>
        <Field label="Graph API Version"><Select value={graphVersion} onValueChange={setGraphVersion}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{data.allowedGraphVersions.map(version => <SelectItem key={version} value={version}>{version}</SelectItem>)}</SelectContent></Select></Field>
        <Field label="القدرات الافتراضية للمتاجر" hint="تحدد ما يطلبه قالب الربط الجديد. يمكن للمتجر تعطيل أي قدرة لاحقاً."><div className="grid gap-2 sm:grid-cols-2">{data.allowedCapabilities.map(purpose => <button key={purpose} type="button" onClick={() => toggleCapability(purpose)} className={`rounded-xl border px-3 py-2.5 text-right text-sm font-bold transition ${capabilities.includes(purpose) ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"}`}>{capabilities.includes(purpose) ? "✓ " : ""}{capabilityLabels[purpose] || purpose}</button>)}</div></Field>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || capabilities.length === 0} onClick={() => save.mutate({ appId, appSecret: appSecret || undefined, businessLoginConfigurationId: businessConfigId, graphApiVersion: graphVersion as "v26.0" | "v25.0" | "v24.0", publicBaseUrl, defaultCapabilities: capabilities as ("messaging" | "content" | "ads_read" | "leads" | "catalog" | "measurement")[] })}><Save className="ml-2 h-4 w-4" />نشر نسخة جديدة من القالب</Button><Button variant="outline" disabled={busy || !settings.appSecretConfigured} onClick={() => test.mutate()}>{test.isPending ? <LoaderCircle className="ml-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="ml-2 h-4 w-4" />}اختبار Meta</Button></div>
      </CardContent></Card>

      <div className="space-y-5">
        <Card className="border-border/80 bg-card/95"><CardHeader><CardTitle className="text-base">الروابط الجاهزة</CardTitle><CardDescription>انسخها إلى إعداد التطبيق في لوحة Meta.</CardDescription></CardHeader><CardContent className="space-y-3"><CopyRow label="OAuth Callback" value={data.oauthCallbackUrl} onCopy={copy} /><CopyRow label="Webhook Callback" value={data.webhookCallbackUrl} onCopy={copy} /></CardContent></Card>
        <Card className="border-border/80 bg-card/95"><CardHeader><CardTitle className="text-base">Webhook Verify Token</CardTitle><CardDescription>{settings.webhookVerifyTokenConfigured ? "محفوظ ومشفر. التدوير يبطل القيمة السابقة في Meta." : "سيُولد تلقائياً عند أول حفظ."}</CardDescription></CardHeader><CardContent><Button variant="outline" className="w-full" disabled={busy} onClick={() => window.confirm("سيصبح Verify Token السابق غير صالح. هل تريد المتابعة؟") && rotate.mutate({ confirm: true })}><RefreshCw className={`ml-2 h-4 w-4 ${rotate.isPending ? "animate-spin" : ""}`} />تدوير الرمز</Button></CardContent></Card>
        <Card className="border-border/80 bg-card/95"><CardContent className="space-y-1 pt-6 text-sm leading-6 text-muted-foreground"><p><strong className="text-foreground">نسخة القالب النشطة:</strong> {settings.activeTemplateName} — v{settings.activeTemplateVersion}</p><p><strong className="text-foreground">مصدر الإعداد:</strong> {settings.source === "database" ? "داخل المنصة" : settings.source === "environment" ? "إعداد انتقالي من الاستضافة" : "غير مهيأ"}</p><p><strong className="text-foreground">آخر اختبار:</strong> {settings.lastTestedAt ? new Date(settings.lastTestedAt).toLocaleString("ar-IQ") : "لا يوجد"}</p>{settings.lastError && <p className="mt-2 text-rose-700">{settings.lastError}</p>}</CardContent></Card>
      </div>
    </div>
  </div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) { return <div className="space-y-2"><Label className="font-bold">{label}</Label>{hint && <p className="text-xs text-muted-foreground">{hint}</p>}{children}</div>; }
function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string, label: string) => Promise<void> }) { return <div className="rounded-xl border bg-background p-3"><p className="text-xs font-bold text-muted-foreground">{label}</p><p className="mt-1 break-all font-mono text-[11px] text-foreground">{value}</p><Button size="sm" variant="ghost" className="mt-2" onClick={() => onCopy(value, label)}><Clipboard className="ml-1.5 h-3.5 w-3.5" />نسخ</Button></div>; }
