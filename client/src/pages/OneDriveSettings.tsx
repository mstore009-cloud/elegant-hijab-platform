import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, CloudCog, Copy, FolderTree, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type TreeNode = {
  folderId: string;
  name: string;
  path: string;
  depth: number;
  kind: "category" | "product" | "needs_review";
  mediaFileCount: number;
  children: TreeNode[];
  warning: string | null;
};

type FolderOption = { id: string; name: string; driveId: string; webUrl: string | null };

function CatalogTreeNode({ node }: { node: TreeNode }) {
  const styles = node.kind === "product" ? "border-[#cce0d7] bg-[#f3faf5] text-[#245b4d]" : node.kind === "needs_review" ? "border-[#f0d6bc] bg-[#fff7ef] text-[#9c4b25]" : "border-[#e2e9e4] bg-white text-[#28463b]";
  const label = node.kind === "product" ? `منتج · ${node.mediaFileCount} وسائط` : node.kind === "needs_review" ? "يحتاج مراجعة" : "تصنيف";
  return <li className="space-y-2"><div className={`rounded-xl border p-3 ${styles}`}><div className="flex items-center justify-between gap-3"><span className="font-bold">{node.name}</span><span className="shrink-0 text-xs">{label}</span></div>{node.warning && <p className="mt-1 text-xs leading-5">{node.warning}</p>}</div>{node.children.length > 0 && <ul className="mr-4 space-y-2 border-r border-[#dce7df] pr-3"><>{node.children.map(child => <CatalogTreeNode key={child.folderId} node={child} />)}</></ul>}</li>;
}

export default function OneDriveSettings() {
  const utils = trpc.useUtils();
  const profile = trpc.access.myProfile.useQuery();
  const appSettings = trpc.integrations.oneDriveAppSettings.useQuery(undefined, { enabled: profile.isSuccess });
  const catalog = trpc.integrations.catalogSelectionStatus.useQuery(undefined, { enabled: profile.isSuccess });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [treePreviewOpen, setTreePreviewOpen] = useState(false);
  const [pickerPath, setPickerPath] = useState<FolderOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authority, setAuthority] = useState<"consumers" | "organizations" | "common">("consumers");
  const [publicBaseUrl, setPublicBaseUrl] = useState(() => typeof window === "undefined" ? "" : window.location.origin);
  const roots = trpc.integrations.catalogRootFolders.useQuery(undefined, { enabled: pickerOpen && catalog.data?.status === "connected" });
  const activePickerFolder = pickerPath[pickerPath.length - 1];
  const activePickerInput = useMemo(() => ({ driveId: activePickerFolder?.driveId ?? "", folderId: activePickerFolder?.id ?? "" }), [activePickerFolder?.driveId, activePickerFolder?.id]);
  const nestedFolders = trpc.integrations.catalogFolderChildren.useQuery(activePickerInput, { enabled: pickerOpen && Boolean(activePickerFolder) });
  const treePreview = trpc.integrations.previewCatalogTree.useQuery(undefined, { enabled: treePreviewOpen && catalog.data?.status === "catalog_selected" });
  const savedCategories = trpc.integrations.productCategoryTree.useQuery(undefined, { enabled: catalog.data?.status === "catalog_selected" });
  const canConfigure = profile.data?.permissions.includes("products.create") ?? false;

  useEffect(() => {
    if (!appSettings.data) return;
    setClientId(appSettings.data.clientId);
    setAuthority(appSettings.data.authority);
    if (appSettings.data.publicBaseUrl) setPublicBaseUrl(appSettings.data.publicBaseUrl);
  }, [appSettings.data?.clientId, appSettings.data?.authority, appSettings.data?.publicBaseUrl]);

  const saveApp = trpc.integrations.saveOneDriveAppSettings.useMutation({
    onSuccess: async () => {
      setClientSecret("");
      await utils.integrations.oneDriveAppSettings.invalidate();
    },
  });
  const testApp = trpc.integrations.testOneDriveAppSettings.useMutation({
    onSuccess: () => utils.integrations.oneDriveAppSettings.invalidate(),
  });

  const connect = trpc.integrations.beginCatalogSelection.useMutation({
    onSuccess: result => window.location.assign(result.authorizationUrl),
  });
  const selectRoot = trpc.integrations.selectCatalogRoot.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.integrations.catalogSelectionStatus.invalidate(), utils.integrations.catalogRootFolders.invalidate()]);
      setPickerOpen(false);
    },
  });
  const syncTree = trpc.integrations.syncCatalogCategoryTree.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.integrations.productCategoryTree.invalidate(), utils.integrations.previewCatalogTree.invalidate()]);
    },
  });

  const isSelected = catalog.data?.status === "catalog_selected";
  const isConnected = catalog.data?.status === "connected";
  const requiresAppConfig = catalog.data?.requiresAppConfig ?? false;
  const appConfigured = appSettings.data?.configured ?? false;
  const proposedRedirectUri = publicBaseUrl.trim().replace(/\/+$/, "") ? `${publicBaseUrl.trim().replace(/\/+$/, "")}/api/onedrive/callback` : "";
  const pickerFolders = (activePickerFolder ? nestedFolders.data : roots.data) as FolderOption[] | undefined;
  const pickerLoading = activePickerFolder ? nestedFolders.isLoading : roots.isLoading;
  const pickerError = activePickerFolder ? nestedFolders.error : roots.error;
  const openRootPicker = () => { setPickerPath([]); setPickerOpen(true); };
  const selectFolderAsRoot = (folder: FolderOption) => {
    const folderPath = ["OneDrive", ...pickerPath.map(item => item.name), folder.name].join("/");
    selectRoot.mutate({ driveId: folder.driveId, folderId: folder.id, folderName: folder.name, folderPath });
  };

  return <main dir="rtl" className="mx-auto max-w-5xl space-y-6 pb-12">
    <header className="rounded-3xl bg-[#173f38] px-6 py-8 text-white shadow-lg">
      <p className="text-sm font-bold text-[#ddc985]">مصادر المنتجات</p>
      <h1 className="mt-2 text-3xl font-black">OneDrive للمتجر</h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[#dce8e1]">يربط هذا الإعداد متجر التشغيل الحالي فقط. تُستخدم ملفات OneDrive كمصدر مرجعي لشجرة الأقسام والوسائط الأصلية، بينما تبقى النسخ المضغوطة داخل المنصة مخصصة للعرض السريع.</p>
    </header>

    <section className="rounded-3xl border border-[#e6ded0] bg-white p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#f7efe0] text-[#9a743a]"><CloudCog className="h-5 w-5" /></div>
        <div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#a47d40]">خطوة 1</p><h2 className="mt-1 font-black text-[#173f38]">إعداد تطبيق Microsoft لهذا المتجر</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-[#68756e]">يدخل صاحب المتجر بيانات تطبيق Microsoft الخاص به هنا. يُخزّن السر مشفّراً ولا يظهر بعد الحفظ، ويُستخدم هذا التطبيق وحده للتفويض وتجديد الوصول ومزامنة ملفات المتجر.</p></div>
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <label className="space-y-2 text-sm font-bold text-[#28463b]"><span>Application (client) ID</span><input value={clientId} onChange={event => setClientId(event.target.value)} disabled={!canConfigure || saveApp.isPending} dir="ltr" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="h-11 w-full rounded-xl border border-[#dce7df] bg-white px-3 text-left font-normal outline-none transition focus:border-[#5e9b79] focus:ring-2 focus:ring-[#dbeee1]" /></label>
        <label className="space-y-2 text-sm font-bold text-[#28463b]"><span>Client Secret {appSettings.data?.clientSecretConfigured ? <em className="mr-1 text-xs font-normal text-[#68756e]">(محفوظ؛ اتركه فارغاً للإبقاء عليه)</em> : null}</span><input value={clientSecret} onChange={event => setClientSecret(event.target.value)} disabled={!canConfigure || saveApp.isPending} dir="ltr" type="password" autoComplete="new-password" placeholder={appSettings.data?.clientSecretConfigured ? "••••••••" : "ألصق Secret Value"} className="h-11 w-full rounded-xl border border-[#dce7df] bg-white px-3 text-left font-normal outline-none transition focus:border-[#5e9b79] focus:ring-2 focus:ring-[#dbeee1]" /></label>
        <label className="space-y-2 text-sm font-bold text-[#28463b]"><span>نوع حساب Microsoft</span><select value={authority} onChange={event => setAuthority(event.target.value as typeof authority)} disabled={!canConfigure || saveApp.isPending} className="h-11 w-full rounded-xl border border-[#dce7df] bg-white px-3 font-normal outline-none transition focus:border-[#5e9b79] focus:ring-2 focus:ring-[#dbeee1]"><option value="consumers">حسابات شخصية فقط</option><option value="organizations">حسابات العمل أو المدرسة فقط</option><option value="common">شخصي أو عمل أو مدرسة</option></select></label>
        <label className="space-y-2 text-sm font-bold text-[#28463b]"><span>النطاق العام المنشور للمنصة</span><input value={publicBaseUrl} onChange={event => setPublicBaseUrl(event.target.value)} disabled={!canConfigure || saveApp.isPending} dir="ltr" placeholder="https://your-store.manus.space" className="h-11 w-full rounded-xl border border-[#dce7df] bg-white px-3 text-left font-normal outline-none transition focus:border-[#5e9b79] focus:ring-2 focus:ring-[#dbeee1]" /></label>
        <div className="space-y-2 text-sm font-bold text-[#28463b]"><span>Redirect URI المطلوب في Microsoft</span><div dir="ltr" className="flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-[#c9dacf] bg-[#f7fbf8] px-3 text-left text-xs font-normal text-[#416153]"><code className="min-w-0 flex-1 break-all">{proposedRedirectUri || "أدخل النطاق العام أولاً"}</code><Button type="button" size="icon" variant="ghost" aria-label="نسخ رابط العودة" disabled={!proposedRedirectUri} onClick={() => navigator.clipboard?.writeText(proposedRedirectUri)}><Copy className="h-4 w-4" /></Button></div></div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2"><Button onClick={() => saveApp.mutate({ clientId, clientSecret: clientSecret || undefined, authority, publicBaseUrl })} disabled={!canConfigure || saveApp.isPending} className="bg-[#173f38] text-white hover:bg-[#245b4d]">{saveApp.isPending ? "جارٍ حفظ الإعداد" : "حفظ إعداد Microsoft"}</Button><Button variant="outline" onClick={() => testApp.mutate()} disabled={!canConfigure || !appConfigured || testApp.isPending} className="border-[#b9d3c6] text-[#245b4d]">{testApp.isPending ? "جارٍ الاختبار" : "اختبار الاتصال"}</Button>{appSettings.data?.status === "verified" && <span className="flex items-center gap-1 text-xs font-bold text-[#246148]"><CheckCircle2 className="h-4 w-4" />الإعداد جاهز</span>}</div>
      {(saveApp.error || testApp.error || appSettings.data?.lastError) && <p className="mt-4 rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-xs leading-5 text-[#9c4b25]">{saveApp.error?.message ?? testApp.error?.message ?? appSettings.data?.lastError}</p>}
    </section>

    <section className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
      <article className="rounded-3xl border border-[#e6ded0] bg-white p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#eaf5ee] text-[#245b4d]"><CloudCog className="h-5 w-5" /></div>
          <div><h2 className="font-black text-[#173f38]">اتصال OneDrive ومجلد الجذر</h2><p className="mt-1 text-sm leading-6 text-[#68756e]">يبدأ كل متجر بتفويض قراءة منفصل ثم اختيار مجلد واحد يكون أصل شجرة الأقسام والمنتجات.</p></div>
        </div>

        {catalog.isLoading ? <div className="mt-6 h-24 animate-pulse rounded-2xl bg-[#f7f4ed]" /> : <div className="mt-6 rounded-2xl border border-[#e4ede7] bg-[#f7fbf8] p-4">
          {requiresAppConfig ? <><div className="font-bold text-[#9c4b25]">يحتاج اتصال OneDrive القديم إلى إعادة تفويض</div><p className="mt-2 text-sm text-[#6f6554]">حُفظ الاتصال قبل إضافة إعداد Microsoft الخاص بالمتجر. احفظ بيانات التطبيق في الخطوة الأولى ثم أعد التفويض؛ لن تُحذف المنتجات أو المجلد المحدد.</p><Button onClick={() => connect.mutate()} disabled={!canConfigure || !appConfigured || connect.isPending} className="mt-4 bg-[#173f38] text-white hover:bg-[#245b4d]">{connect.isPending ? "جارٍ فتح التفويض" : "إعادة تفويض OneDrive"}</Button></> : isSelected ? <><div className="flex items-center gap-2 font-bold text-[#1d654b]"><CheckCircle2 className="h-5 w-5" />مجلد الجذر محدد لهذا المتجر</div><p className="mt-2 text-sm text-[#536d61]">{catalog.data?.selectedFolderPath ?? catalog.data?.selectedFolderName ?? "مجلد OneDrive محدد"}</p><div className="mt-4 flex flex-wrap gap-2"><Button onClick={openRootPicker} disabled={!canConfigure} variant="outline" className="border-[#b9d3c6] text-[#245b4d]"><FolderTree className="ml-1.5 h-4 w-4" />تغيير المجلد</Button><Button onClick={() => window.location.assign("/products")} className="bg-[#173f38] text-white hover:bg-[#245b4d]">فتح المنتجات</Button></div></> : isConnected ? <><div className="flex items-center gap-2 font-bold text-[#7a5a25]"><FolderTree className="h-5 w-5" />تم التفويض؛ اختر جذر المنتجات</div><p className="mt-2 text-sm text-[#6f6554]">لن تُنشأ منتجات أو تُقرأ ملفات المنتج قبل اختيار المجلد.</p><Button onClick={openRootPicker} disabled={!canConfigure} className="mt-4 bg-[#173f38] text-white hover:bg-[#245b4d]">اختيار مجلد الجذر</Button></> : <><div className="font-bold text-[#7a5a25]">OneDrive غير مرتبط لهذا المتجر</div><p className="mt-2 text-sm text-[#6f6554]">{appConfigured ? "افتح تفويض Microsoft بالحساب الذي يملك مجلد المنتجات. لا تُخزّن كلمة المرور في المنصة." : "ابدأ بحفظ إعداد Microsoft في الخطوة الأولى، ثم اختبره قبل فتح التفويض."}</p><Button onClick={() => connect.mutate()} disabled={!canConfigure || !appConfigured || connect.isPending} className="mt-4 bg-[#173f38] text-white hover:bg-[#245b4d]">{connect.isPending ? "جارٍ فتح التفويض" : "ربط OneDrive"}</Button></>}
          {catalog.data?.lastError && <p className="mt-4 rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-xs leading-5 text-[#9c4b25]">{catalog.data.lastError}</p>}
          {(connect.error || selectRoot.error) && <p className="mt-4 rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-xs leading-5 text-[#9c4b25]">{connect.error?.message ?? selectRoot.error?.message}</p>}
        </div>}
      </article>

      <aside className="rounded-3xl border border-[#e6ded0] bg-[#fcfaf5] p-6"><div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-[#a47d40]" /><div><h2 className="font-black text-[#173f38]">حدود الوصول</h2><p className="text-xs text-[#68756e]">مرتبطة بالمتجر لا بالمستخدم.</p></div></div><ul className="mt-5 space-y-3 text-sm leading-6 text-[#52645c]"><li>يُحفظ رمز التفويض مشفراً ولا يظهر في الواجهة.</li><li>لا يمكن لمتجر ثانٍ قراءة شجرة هذا المتجر أو وسائطه.</li><li>اختيار الجذر لا يغيّر ملفات OneDrive ولا يحذف المنتجات الحالية.</li><li>يُستخدم الأصل عالي الجودة عند النشر أو التصدير، لا لتثقيل واجهة المنصة.</li></ul></aside>
    </section>

    {isSelected && <section className="rounded-3xl border border-[#e6ded0] bg-white p-6"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[#a47d40]">شجرة OneDrive</p><h2 className="mt-1 text-xl font-black text-[#173f38]">معاينة الأقسام والمنتجات</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-[#68756e]">تتعرف المنصة على المنتج فقط عندما يجتمع ملف معلومات <span dir="ltr">product.txt</span> أو <span dir="ltr">product.docx</span> مع صورة أو فيديو. هذه المعاينة لا تستورد منتجاً ولا تنزّل وسائط.</p></div><Button onClick={() => setTreePreviewOpen(value => !value)} variant="outline" className="border-[#b9d3c6] text-[#245b4d]"><FolderTree className="ml-1.5 h-4 w-4" />{treePreviewOpen ? "إخفاء المعاينة" : "معاينة الشجرة"}</Button></div>{savedCategories.data?.length ? <p className="mt-4 text-xs text-[#536d61]">التصنيفات المحفوظة حالياً: {savedCategories.data.length} تصنيفاً. إعادة الاعتماد تحدثها وفق شجرة OneDrive ولا تحذف المنتجات.</p> : null}{treePreviewOpen && <div className="mt-5">{treePreview.isLoading && <p className="flex items-center gap-2 rounded-2xl bg-[#f7f4ed] p-4 text-sm text-[#68756e]"><RefreshCw className="h-4 w-4 animate-spin" />جارٍ قراءة أسماء المجلدات والملفات…</p>}{treePreview.error && <p className="rounded-2xl border border-[#f0d6bc] bg-[#fff7ef] p-4 text-sm text-[#9c4b25]">{treePreview.error.message}</p>}{treePreview.data && <><div className="flex flex-wrap gap-2 rounded-2xl bg-[#f7fbf8] p-3 text-xs text-[#536d61]"><span className="rounded-full bg-white px-3 py-1.5">{treePreview.data.summary.categories} تصنيفات</span><span className="rounded-full bg-white px-3 py-1.5">{treePreview.data.summary.products} مجلدات منتجات</span><span className="rounded-full bg-white px-3 py-1.5">{treePreview.data.summary.needsReview} تحتاج مراجعة</span><span className="rounded-full bg-white px-3 py-1.5">{treePreview.data.summary.scannedFolders} مجلدات مقروءة</span></div><ul className="mt-4 space-y-2"><CatalogTreeNode node={treePreview.data.root as TreeNode} /></ul><div className="mt-5 rounded-2xl border border-[#eadcbf] bg-[#fffaf0] p-4"><p className="text-sm font-bold text-[#6f5b35]">اعتماد التصنيفات فقط</p><p className="mt-1 text-xs leading-5 text-[#7a6951]">يحفظ هذا الزر مجلدات التصنيف فقط في المنصة، ولا ينشئ منتجات ولا يغير ملفات OneDrive. سيبقى استيراد المنتجات خطوة منفصلة بعد مراجعة هذه الشجرة.</p><Button onClick={() => syncTree.mutate()} disabled={!canConfigure || syncTree.isPending} className="mt-3 bg-[#173f38] text-white hover:bg-[#245b4d]">{syncTree.isPending ? "جارٍ حفظ التصنيفات" : "اعتماد شجرة التصنيفات"}</Button>{syncTree.data && <p className="mt-3 text-xs text-[#245b4d]">تم إنشاء {syncTree.data.created} وتحديث {syncTree.data.updated} تصنيفاً.</p>}{syncTree.error && <p className="mt-3 text-xs text-[#9c4b25]">{syncTree.error.message}</p>}</div></>}</div>}</section>}

    <Dialog open={pickerOpen} onOpenChange={open => { setPickerOpen(open); if (!open) setPickerPath([]); }}><DialogContent dir="rtl" className="max-w-lg"><DialogHeader><DialogTitle>اختيار جذر شجرة المنتجات</DialogTitle><DialogDescription>يمكنك فتح أي مجلد متداخل ثم اعتماده كجذر. التغيير لا يحذف ملفات OneDrive أو منتجات المنصة.</DialogDescription></DialogHeader><div className="mt-2 flex flex-wrap items-center gap-1 rounded-xl bg-[#f7fbf8] p-2 text-xs"><button type="button" className="rounded-lg px-2 py-1 font-bold text-[#245b4d] hover:bg-white" onClick={() => setPickerPath([])}>OneDrive</button>{pickerPath.map((item, index) => <span key={item.id} className="flex items-center gap-1"><span className="text-[#8ca095]">/</span><button type="button" className="rounded-lg px-2 py-1 text-[#416153] hover:bg-white" onClick={() => setPickerPath(pickerPath.slice(0, index + 1))}>{item.name}</button></span>)}</div><div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">{pickerLoading && <p className="flex items-center gap-2 rounded-xl bg-[#f7f4ed] p-3 text-sm text-[#68756e]"><RefreshCw className="h-4 w-4 animate-spin" />جارٍ قراءة المجلدات…</p>}{pickerError && <p className="rounded-xl border border-[#f0d6bc] bg-[#fff7ef] p-3 text-sm text-[#9c4b25]">{pickerError.message}</p>}{pickerFolders?.map(folder => <div key={folder.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#e3e9e4] bg-white px-4 py-3"><span className="min-w-0 flex-1 truncate font-semibold text-[#28463b]">{folder.name}</span><div className="flex shrink-0 gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setPickerPath([...pickerPath, folder])} disabled={selectRoot.isPending} className="border-[#b9d3c6] text-[#245b4d]">فتح</Button><Button type="button" size="sm" onClick={() => selectFolderAsRoot(folder)} disabled={selectRoot.isPending} className="bg-[#173f38] text-white hover:bg-[#245b4d]">اختيار</Button></div></div>)}{pickerFolders && !pickerFolders.length && <p className="rounded-xl bg-[#f7f4ed] p-3 text-sm text-[#68756e]">لا توجد مجلدات داخل هذا المسار.</p>}</div></DialogContent></Dialog>
  </main>;
}
