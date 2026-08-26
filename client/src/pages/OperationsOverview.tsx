import { trpc } from "@/lib/trpc";
import { AlertCircle, ArrowUpRight, FileCheck2, KeyRound, LockKeyhole, ShieldCheck, Sparkles, UsersRound } from "lucide-react";

const foundations = [
  {
    title: "الصلاحيات الحبيبية",
    description: "كل موظف يحصل على العمليات التي يحتاجها فقط، لا على قسم كامل بلا ضوابط.",
    icon: KeyRound,
    status: "قيد البناء",
  },
  {
    title: "البيانات الحساسة",
    description: "أسعار التكلفة والهوامش لا تظهر ولا تعود عبر النظام إلا لصاحب التصريح المالي.",
    icon: LockKeyhole,
    status: "محمي في النواة",
  },
  {
    title: "سجل الاعتماد",
    description: "كل فرع يرتبط بقرار واختبار قبول قبل دمجه في التشغيل اليومي.",
    icon: FileCheck2,
    status: "مفعّل",
  },
];

export default function OperationsOverview() {
  const profile = trpc.access.myProfile.useQuery();
  const safePermissionCount = profile.data?.permissions.filter(code => code !== "finance.view_sensitive").length ?? 0;

  return (
    <div dir="rtl" className="mx-auto w-full min-w-0 max-w-7xl space-y-7 pb-10">
      <section className="relative overflow-hidden rounded-[2rem] bg-[#153d35] px-6 py-8 text-[#fcfbf7] shadow-[0_28px_70px_rgba(18,59,51,0.24)] sm:px-10 sm:py-10">
        <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full border border-[#d9bd7c]/30" />
        <div className="pointer-events-none absolute bottom-[-100px] left-20 h-64 w-64 rounded-full bg-[#2b6558]/40 blur-3xl" />
        <div className="relative grid gap-7 lg:grid-cols-[1.25fr_0.75fr] lg:items-end">
          <div>
            <div className="mb-4 flex w-fit items-center gap-2 rounded-full border border-[#d9bd7c]/35 bg-[#fcfbf7]/10 px-3 py-1 text-xs text-[#f0dfa9] backdrop-blur-sm">
              <Sparkles className="h-3.5 w-3.5" />
              نقطة الانطلاق المعتمدة
            </div>
            <h1 className="max-w-2xl text-3xl font-bold leading-[1.45] sm:text-4xl">
              منصة تشغيل موحّدة، مبنية على <span className="text-[#f0d492]">الدقة والثقة</span> قبل الأتمتة.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-[#dceae5] sm:text-base">
              بدأنا بالنواة التي تحمي العمل كله: هوية واضحة، صلاحيات حسب العملية، وعزل كامل للمعلومات المالية عن غير المخولين.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-sm">
            <div>
              <p className="text-xs text-[#c5d9d2]">حالة المرجع</p>
              <p className="mt-1 text-lg font-semibold text-[#f8e5b4]">v0.2</p>
              <p className="text-xs text-[#c5d9d2]">مراجَع ومعتمد للبدء</p>
            </div>
            <div className="border-r border-white/10 pr-3">
              <p className="text-xs text-[#c5d9d2]">المتجر التشغيلي</p>
              <p className="mt-1 truncate text-lg font-semibold">{profile.data?.store?.store.name ?? "جارٍ التحقق"}</p>
              <p className="text-xs text-[#c5d9d2]">{profile.data?.store?.store.slug ? `/${profile.data.store.store.slug}` : "نواة التشغيل"}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {foundations.map(item => {
          const Icon = item.icon;
          return (
            <article key={item.title} className="group rounded-2xl border border-[#e8e2d5] bg-white p-5 shadow-[0_12px_30px_rgba(45,57,48,0.06)] transition-transform duration-200 hover:-translate-y-1">
              <div className="flex items-start justify-between gap-4">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf5f1] text-[#1f5b4f]">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="rounded-full bg-[#f8f2e5] px-2.5 py-1 text-[11px] font-medium text-[#8a6a2d]">{item.status}</span>
              </div>
              <h2 className="mt-5 text-base font-bold text-[#243a34]">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-[#6a746e]">{item.description}</p>
            </article>
          );
        })}
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-2xl border border-[#e8e2d5] bg-white p-6 shadow-[0_12px_30px_rgba(45,57,48,0.06)]">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold tracking-[0.14em] text-[#9a7b3e]">طبقة الوصول</p>
              <h2 className="mt-1 text-xl font-bold text-[#243a34]">وصولك الحالي</h2>
            </div>
            <ShieldCheck className="h-9 w-9 text-[#1f5b4f]" />
          </div>

          {profile.isLoading ? (
            <div className="mt-6 h-24 animate-pulse rounded-xl bg-[#f6f5f0]" />
          ) : profile.error ? (
            <div className="mt-6 flex gap-3 rounded-xl bg-[#fff4ed] p-4 text-sm text-[#9c4b25]">
              <AlertCircle className="h-5 w-5 shrink-0" />
              لا يمكن تحميل صلاحياتك حاليًا. سيتم التعامل مع هذا كحالة وصول آمنة حتى يعود الاتصال.
            </div>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-[#f4f7f4] p-4">
                <p className="text-xs text-[#74817a]">نوع الحساب</p>
                <p className="mt-1 text-lg font-bold text-[#243a34]">{profile.data?.user.role === "admin" ? "مدير المنصة" : "موظف"}</p>
              </div>
              <div className="rounded-xl bg-[#f4f7f4] p-4">
                <p className="text-xs text-[#74817a]">عمليات ممنوحة</p>
                <p className="mt-1 text-lg font-bold text-[#243a34]">{safePermissionCount} صلاحية تشغيلية</p>
              </div>
              <div className="sm:col-span-2 rounded-xl border border-[#dce9e1] bg-[#f5faf7] p-4">
                <p className="text-xs text-[#74817a]">نطاق المتجر الحالي</p>
                <p className="mt-1 text-lg font-bold text-[#243a34]">{profile.data?.store?.store.name ?? "لا يوجد متجر تشغيلي مخصص"}</p>
                <p className="mt-1 text-xs text-[#74817a]">
                  {profile.data?.store?.store.slug ? `تظهر مسودات المحتوى وسجل الصلاحيات ضمن /${profile.data.store.store.slug} فقط.` : "يتم منع الوصول التشغيلي حتى تحديد متجر صالح."}
                </p>
              </div>
              <div className="sm:col-span-2 flex items-center justify-between rounded-xl border border-[#ece4d5] px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className={`h-2.5 w-2.5 rounded-full ${profile.data?.canViewSensitiveFinancialData ? "bg-[#3c9076]" : "bg-[#c5a45e]"}`} />
                  <div>
                    <p className="text-sm font-semibold text-[#364940]">عرض البيانات المالية الحساسة</p>
                    <p className="text-xs text-[#74817a]">تُفرض الصلاحية في الواجهة الخلفية قبل عودة أي بيانات مالية.</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-[#1f5b4f]">{profile.data?.canViewSensitiveFinancialData ? "مسموح" : "غير مسموح"}</span>
              </div>
            </div>
          )}
        </article>

        <article className="rounded-2xl bg-[#f7f3ea] p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e8d3a3] text-[#72551d]"><UsersRound className="h-5 w-5" /></span>
            <div>
              <h2 className="font-bold text-[#3b382d]">مسار التنفيذ</h2>
              <p className="text-xs text-[#766f60]">لا ينتقل النظام بين الوحدات عشوائيًا.</p>
            </div>
          </div>
          <ol className="mt-5 space-y-3 text-sm text-[#5b5b51]">
            <li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#153d35] text-xs text-white">1</span> تثبيت صلاحيات الموظف وبياناته الحساسة.</li>
            <li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#ded4bd] text-xs text-[#594f3c]">2</span> إضافة المنتجات والمتغيرات والمخزون.</li>
            <li className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#ded4bd] text-xs text-[#594f3c]">3</span> اختبار OneDrive قبل ربط أي مسار تابع له.</li>
          </ol>
          <a href="/permissions" className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#1f5b4f] hover:text-[#153d35]">
            مراجعة هيكل الصلاحيات <ArrowUpRight className="h-4 w-4" />
          </a>
        </article>
      </section>
    </div>
  );
}
