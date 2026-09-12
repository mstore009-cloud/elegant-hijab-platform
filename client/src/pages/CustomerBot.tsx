import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomerBotNav, SafetyNotice } from "@/components/customerBot/CustomerBotNav";
import { trpc } from "@/lib/trpc";
import { BookOpenText, Bot, ClipboardCheck, MessageSquareText, Mic, Settings2 } from "lucide-react";
import { useLocation } from "wouter";

const paths = [
  { title: "مختبر المحادثة", description: "اختبري الرد كما تراه الزبونة، عدّلي الرد، ثم احفظي التعديل كمسودة تعليمية.", path: "/customer-bot/playground", icon: MessageSquareText, tone: "bg-[#eef7f2] text-[#1d5a4d]" },
  { title: "مساعد الأوامر", description: "اكتبي أو سجّلي ما تريدينه، ثم راجعي أين سيُحفظ التغيير قبل تأكيده كمسودة.", path: "/customer-bot/commands", icon: Mic, tone: "bg-[#f6f0fb] text-[#7048a5]" },
  { title: "المعرفة والتعلم", description: "راجعي بطاقات RAG وأمثلة اللهجة وردود الموظفين دون تحويل الحقائق المتغيرة إلى نصوص ثابتة.", path: "/customer-bot/learning", icon: BookOpenText, tone: "bg-[#fff5e8] text-[#a35d1e]" },
  { title: "الاختبارات والمسودات", description: "اعتمدي أو ارفضي اقتراحات التعلم، وراجعي الإجراءات وحالات الاختبار قبل النشر.", path: "/customer-bot/testing", icon: ClipboardCheck, tone: "bg-[#edf3fb] text-[#406a95]" },
];

export default function CustomerBot() {
  const [_, setLocation] = useLocation();
  const profile = trpc.access.myProfile.useQuery();
  const canManage = profile.data?.permissions.includes("bot.manage") ?? false;
  const settings = trpc.customerBot.settings.useQuery(undefined, { enabled: canManage });
  const quality = trpc.customerBot.qualitySummary.useQuery(undefined, { enabled: canManage });
  const proposals = trpc.customerBot.learningProposals.useQuery({ status: "draft" }, { enabled: canManage });

  if (profile.isLoading || (canManage && settings.isLoading)) return <div className="p-8 text-sm text-muted-foreground">جارٍ تحميل مركز البوت…</div>;
  if (!canManage) return <div dir="rtl" className="mx-auto max-w-3xl rounded-2xl border bg-card p-8 text-center"><Bot className="mx-auto h-9 w-9 text-muted-foreground" /><h1 className="mt-4 text-xl font-bold">لا تملكين صلاحية إدارة البوت</h1><p className="mt-2 text-sm text-muted-foreground">راجعي مدير المنصة لمنح صلاحية إدارة البوت أو مراجعة المعرفة.</p></div>;

  const operational = settings.data?.enabled;
  const mode = settings.data?.mode === "auto_reply" ? "رد مباشر مشروط" : "مسودة فقط";
  const summary = quality.data;
  return <main dir="rtl" className="mx-auto max-w-6xl space-y-5 pb-10">
    <CustomerBotNav title="مركز تدريب Bot العملاء" description="كل مهمة في مكانها: الإعدادات في صفحة مستقلة، التدريب في مكتبة، التجربة في مختبر آمن، والأوامر في مساعد يشرح التغيير قبل حفظه." action={<Button onClick={() => setLocation("/customer-bot/settings")} variant="outline" className="rounded-xl border-[#d4ddd7] bg-white"><Settings2 className="ml-2 h-4 w-4" />إعدادات التشغيل</Button>} />
    <SafetyNotice />
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric label="حالة التشغيل" value={operational ? mode : "متوقف"} note={operational ? "تُدار القنوات من إعدادات التشغيل" : "يمكن التدريب والاختبار وهو متوقف"} />
      <Metric label="اقتراحات بانتظار المراجعة" value={String(proposals.data?.length ?? 0)} note="لا تدخل في الرد الحي قبل الاعتماد" />
      <Metric label="فجوات معرفة مفتوحة" value={String(summary?.openGaps ?? 0)} note="تعني أن البوت لم يحصل على معلومة كافية" />
      <Metric label="مسودات روجعت" value={String(summary?.reviewed ?? 0)} note="قياس تعلم الفريق وليس تدريباً صامتاً" />
    </section>
    <section className="grid gap-4 md:grid-cols-2">
      {paths.map(item => { const Icon = item.icon; return <button key={item.path} type="button" onClick={() => setLocation(item.path)} className="group rounded-2xl border border-[#e4e8e4] bg-white p-5 text-right shadow-[0_8px_24px_rgba(41,63,53,0.045)] transition hover:-translate-y-0.5 hover:border-[#bed6c7] hover:shadow-[0_16px_32px_rgba(41,63,53,0.09)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1d5a4d]"><span className={`grid h-11 w-11 place-items-center rounded-2xl ${item.tone}`}><Icon className="h-5 w-5" /></span><h2 className="mt-4 text-base font-bold text-[#2c4439]">{item.title}</h2><p className="mt-1.5 text-sm leading-6 text-[#718077]">{item.description}</p><span className="mt-4 inline-flex items-center text-xs font-bold text-[#1d5a4d] group-hover:underline">فتح القسم ←</span></button>; })}
    </section>
    <section className="rounded-2xl border border-[#e7e1d5] bg-white p-5 shadow-[0_10px_25px_rgba(40,61,51,0.05)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-[#30473d]">قاعدة العمل</h2><p className="mt-1 text-sm text-[#74817a]">جرّبي → راجعي → عدّلي → صنّفي → احفظي مسودة → اختبري → اعتمدي.</p></div><Badge className="w-fit bg-[#edf5f1] text-[#276050]">RAG داخلي ومراجعة بشرية</Badge></div>
    </section>
  </main>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-2xl border border-[#e3e9e4] bg-white p-4 shadow-[0_8px_20px_rgba(41,63,53,0.04)]"><p className="text-xs font-medium text-[#7a887f]">{label}</p><p className="mt-2 text-lg font-bold text-[#29483b]">{value}</p><p className="mt-1 text-[11px] leading-5 text-[#849087]">{note}</p></div>;
}
