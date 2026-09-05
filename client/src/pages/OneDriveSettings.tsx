import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, CloudCog, Copy, ExternalLink, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

export default function OneDriveSettings() {
  const utils = trpc.useUtils();
  const profile = trpc.access.myProfile.useQuery();
  const appSettings = trpc.integrations.oneDriveAppSettings.useQuery(undefined, { enabled: profile.isSuccess });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authority, setAuthority] = useState<"consumers" | "organizations" | "common">("consumers");
  const [publicBaseUrl, setPublicBaseUrl] = useState(() => typeof window === "undefined" ? "" : window.location.origin);
  const canConfigure = profile.data?.permissions.includes("products.create") ?? false;
  const saveApp = trpc.integrations.saveOneDriveAppSettings.useMutation({ onSuccess: async () => { setClientSecret(""); await utils.integrations.oneDriveAppSettings.invalidate(); } });
  const testApp = trpc.integrations.testOneDriveAppSettings.useMutation({ onSuccess: () => utils.integrations.oneDriveAppSettings.invalidate() });
  useEffect(() => {
    if (!appSettings.data) return;
    setClientId(appSettings.data.clientId);
    setAuthority(appSettings.data.authority);
    if (appSettings.data.publicBaseUrl) setPublicBaseUrl(appSettings.data.publicBaseUrl);
  }, [appSettings.data?.clientId, appSettings.data?.authority, appSettings.data?.publicBaseUrl]);
  const proposedRedirectUri = publicBaseUrl.trim().replace(/\/+$/, "") ? `${publicBaseUrl.trim().replace(/\/+$/, "")}/api/onedrive/callback` : "";

  return <main dir="rtl" className="mx-auto max-w-5xl space-y-6 pb-12">
    <header className="rounded-3xl bg-[#173f38] px-6 py-8 text-white shadow-lg"><p className="text-sm font-bold text-[#ddc985]">الإعدادات الخارجية</p><h1 className="mt-2 text-3xl font-black">إعداد تطبيق OneDrive</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[#dce8e1]">تُدار مفاتيح Microsoft الخاصة بالمتجر هنا فقط. أما الاتصال، جذر المنتجات، معاينة الشجرة، والاستيراد الفعلي فتوجد الآن داخل قسم المنتجات.</p></header>
    <section className="rounded-3xl border border-[#e6ded0] bg-white p-6">
      <div className="flex items-start gap-3"><div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#f7efe0] text-[#9a743a]"><CloudCog className="h-5 w-5" /></div><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#a47d40]">إعداد Microsoft</p><h2 className="mt-1 font-black text-[#173f38]">بيانات تطبيق Microsoft لهذا المتجر</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-[#68756e]">يُخزّن Client Secret مشفراً ولا يعود إلى المتصفح بعد الحفظ. استخدم تطبيقاً واحداً مخصصاً لهذا المتجر وتأكد أن Redirect URI مسجل تحت Web في Microsoft Entra.</p></div></div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <label className="space-y-2 text-sm font-bold text-[#28463b]"><span>Application (client) ID</span><input value={clientId} onChange={event => setClientId(event.target.value)} disabled={!canConfigure || saveApp.isPending} dir="ltr" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="h-11 w-full rounded-xl border border-[#dce7df] bg-white px-3 text-left font-normal outline-none transition focus:border-[#5e9b79] focus:ring-2 focus:ring-[#dbeee1]" /></label>
        <label className="space-y-2 text-sm font-bold text-[#28463b]"><span>Client Secret {appSettings.data?.clientSecretConfigured ? <em className="mr-1 text-xs font-normal text-[#68756e]">(محفوظ؛ اتركه فارغاً للإبقاء عليه)</em> : null}</span><input value={clientSecret} onChange={event => setClientSecret(event.target.value)} disabled={!canConfigure || saveApp.isPending} dir="ltr" type="password" autoComplete="new-password" placeholder={appSettings.data?.clientSecretConfigured ? "••••••••" : "ألصق Secret Value"} className="h-11 w-full rounded-xl border border-[#dce7df] bg-white px-3 text-left font-normal outline-none transition focus:border-[#5e9b79] focus:ring-2 focus:ring-[#dbeee1]" /></label>
        <label className="space-y-2 text-sm font-bold text-[#28463b]"><span>نوع حساب Microsoft</span><select value={authority} onChange={event => setAuthority(event.target.value as typeof authority)} disabled={!canConfigure || saveApp.isPending} className="h-11 w-full rounded-xl border border-[#dce7df] bg-white px-3 font-normal outline-none transition focus:border-[#5e9b79] focus:ring-2 focus:ring-[#dbeee1]"><option value="consumers">حسابات شخصية فقط</option><option value="organizations">حسابات العمل أو المدرسة فقط</option><option value="common">شخصي أو عمل أو مدرسة</option></select></label>
        <label className="space-y-2 text-sm font-bold text-[#28463b]"><span>النطاق العام المنشور للمنصة</span><input value={publicBaseUrl} onChange={event => setPublicBaseUrl(event.target.value)} disabled={!canConfigure || saveApp.isPending} dir="ltr" placeholder="https://your-store.manus.space" className="h-11 w-full rounded-xl border border-[#dce7df] bg-white px-3 text-left font-normal outline-none transition focus:border-[#5e9b79] focus:ring-2 focus:ring-[#dbeee1]" /></label>
        <div className="space-y-2 text-sm font-bold text-[#28463b] lg:col-span-2"><span>Redirect URI المطلوب في Microsoft</span><div dir="ltr" className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-[#c9dacf] bg-[#f7fbf8] px-3 text-left text-xs font-normal text-[#416153]"><code className="min-w-0 flex-1 break-all">{proposedRedirectUri || "أدخل النطاق العام أولاً"}</code><Button type="button" size="icon" variant="ghost" aria-label="نسخ رابط العودة" disabled={!proposedRedirectUri} onClick={() => navigator.clipboard?.writeText(proposedRedirectUri)}><Copy className="h-4 w-4" /></Button></div></div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2"><Button onClick={() => saveApp.mutate({ clientId, clientSecret: clientSecret || undefined, authority, publicBaseUrl })} disabled={!canConfigure || saveApp.isPending} className="bg-[#173f38] text-white hover:bg-[#245b4d]">{saveApp.isPending ? "جارٍ حفظ الإعداد" : "حفظ إعداد Microsoft"}</Button><Button variant="outline" onClick={() => testApp.mutate()} disabled={!canConfigure || !appSettings.data?.configured || testApp.isPending} className="border-[#b9d3c6] text-[#245b4d]">{testApp.isPending ? "جارٍ الاختبار" : "اختبار الاتصال"}</Button>{appSettings.data?.status === "verified" && <span className="flex items-center gap-1 text-xs font-bold text-[#246148]"><CheckCircle2 className="h-4 w-4" />الإعداد جاهز</span>}</div>
      {(saveApp.error || testApp.error || appSettings.data?.lastError) && <p className="mt-4 rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-xs leading-5 text-[#9c4b25]">{saveApp.error?.message ?? testApp.error?.message ?? appSettings.data?.lastError}</p>}
    </section>
    <section className="grid gap-5 md:grid-cols-2"><article className="rounded-3xl border border-[#e6ded0] bg-[#fcfaf5] p-6"><div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-[#a47d40]" /><div><h2 className="font-black text-[#173f38]">ما يبقى هنا</h2><p className="text-xs text-[#68756e]">إعدادات التطبيق السرية فقط.</p></div></div><p className="mt-4 text-sm leading-6 text-[#52645c]">تعديل Client ID وClient Secret ونوع حساب Microsoft والنطاق العام. لا تعرض هذه الصفحة محتوى المجلدات ولا تبدأ استيراد المنتجات.</p></article><article className="rounded-3xl border border-[#d8e5de] bg-[#f7fbf8] p-6"><div className="flex items-center gap-3"><ExternalLink className="h-6 w-6 text-[#245b4d]" /><div><h2 className="font-black text-[#173f38]">الخطوة التشغيلية التالية</h2><p className="text-xs text-[#68756e]">تُنفذ من قسم المنتجات.</p></div></div><p className="mt-4 text-sm leading-6 text-[#52645c]">بعد حفظ الإعداد واختباره، افتح قسم المنتجات لاختيار الجذر، معاينة الشجرة، اعتماد التصنيفات، ثم استيراد أو تحديث المنتجات من OneDrive.</p><Button type="button" onClick={() => window.location.assign("/products")} className="mt-4 bg-[#173f38] text-white hover:bg-[#245b4d]">فتح المنتجات</Button></article></section>
  </main>;
}
