import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BookOpenText, CheckCircle2, CircleHelp, FlaskConical, GitBranch, MessageCircle, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";

const groups = [
  { id: "style", label: "طريقة الكلام", description: "لهجة، نبرة، اختصار ودفء", icon: Sparkles, tone: "bg-[#f5effa] text-[#7048a5]", templates: ["خلي كلامك عراقي، بسيط، مختصر، ومهذب.", "خاطبي الزبونة بدفء، واستخدمي مفردات شعبية مناسبة بدون مبالغة."] },
  { id: "reply", label: "نموذج رد", description: "صياغة جواب لسؤال متكرر", icon: MessageCircle, tone: "bg-[#edf5f1] text-[#1d5a4d]", templates: ["إذا سألت الزبونة عن [الموضوع]، ابدئي بتحية قصيرة ويكون الرد قريباً من: [الصياغة].", "إذا سألت الزبونة عن السعر، اذكري السعر من بيانات المنتج الحية ثم اسأليها إن كانت تريدين عرض الألوان."] },
  { id: "playbook", label: "خطوات البيع", description: "شرط وتسلسل تصرف", icon: GitBranch, tone: "bg-[#fff5e8] text-[#9a641c]", templates: ["إذا حدث [الموقف]، نفذي الخطوات التالية: 1) [الخطوة الأولى]، 2) [الخطوة الثانية]، 3) [الخطوة الثالثة].", "بعد قراءة Product Code، اعرضي السعر من المنتج الحي، ثم اسألي عن صور الألوان أو بطاقة المنتج حسب اختيار الزبونة."] },
  { id: "knowledge", label: "معلومة أو سياسة", description: "معلومة ثابتة تحتاج مراجعة", icon: BookOpenText, tone: "bg-[#eef4fa] text-[#406a95]", templates: ["أضيفي سياسة [اسم السياسة] إلى المعرفة كمسودة: [النص المؤكد].", "أضيفي هذه المعلومة الثابتة إلى المعرفة واتركيها مسودة للمراجعة: [المعلومة]."] },
  { id: "guardrail", label: "حماية وممنوعات", description: "ما لا يجب قوله أو فعله", icon: ShieldAlert, tone: "bg-[#fff0ee] text-[#a24f46]", templates: ["لا [السلوك الممنوع]، وإذا حدث [الشرط] استخدمي رسالة انتظار مهذبة وسجلي تنبيهاً للموظف.", "لا تخمني السعر أو المخزون، ولا تقولي إن الطلب تثبت قبل الاعتماد."] },
  { id: "test", label: "اختبار للبوت", description: "حالة نعيد اختبارها لاحقاً", icon: FlaskConical, tone: "bg-[#f1f3f8] text-[#53648b]", templates: ["حوّلي هذه الحالة إلى اختبار: عندما تقول الزبونة [الرسالة]، يجب أن تكون النتيجة [النتيجة المتوقعة].", "اختبري أن طلب الخصم ينتقل إلى الموظف بدون وعد أو تغيير في السعر."] },
  { id: "gap", label: "معلومة ناقصة", description: "قرار أو سياسة نحتاجها", icon: CircleHelp, tone: "bg-[#f4f1eb] text-[#8b7350]", templates: ["سجلي فجوة معرفة: لا توجد إجابة مؤكدة عن [الموضوع] ونحتاج قراراً من الإدارة.", "نحتاج سياسة واضحة بخصوص [الموضوع] قبل أن يجيب البوت عنه."] },
] as const;

export default function TrainingCommandLibrary({ onUseTemplate }: { onUseTemplate: (template: string) => void }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const active = groups.find(group => group.id === openGroup);
  return <section dir="rtl" className="rounded-2xl border border-[#e4e8e4] bg-[#fcfdfb] p-4">
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 font-bold text-[#30473d]"><BookOpenText className="h-4 w-4 text-[#1d5a4d]" />مكتبة الأوامر والقوالب</h2><p className="mt-1 text-xs leading-5 text-[#74817a]">اختاري ما تريدين تعليمه، ثم عدّلي القالب قبل إرساله للمساعد.</p></div><Badge variant="outline" className="w-fit text-[10px]">لا تنفيذ تلقائي</Badge></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{groups.map(group => { const Icon = group.icon; const selected = openGroup === group.id; return <button key={group.id} type="button" onClick={() => setOpenGroup(selected ? null : group.id)} className={`flex items-start gap-3 rounded-xl border p-3 text-right transition ${selected ? "border-[#bcd6c5] bg-white shadow-sm" : "border-[#e6ebe6] bg-white/70 hover:border-[#cbdccf]"}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${group.tone}`}><Icon className="h-4 w-4" /></span><span><span className="block text-sm font-bold text-[#40584a]">{group.label}</span><span className="mt-1 block text-[11px] leading-5 text-[#7a887f]">{group.description}</span></span></button>; })}</div>
    {active ? <div className="mt-3 rounded-xl border border-[#dce8df] bg-white p-3"><p className="text-xs font-bold text-[#52685a]">اختاري قالباً ثم عدّليه حسب متجرك</p><div className="mt-2 grid gap-2">{active.templates.map(template => <Button key={template} type="button" variant="outline" onClick={() => onUseTemplate(template)} className="h-auto justify-between whitespace-normal rounded-xl border-[#dce8df] px-3 py-2 text-right text-xs leading-5 text-[#476151] hover:bg-[#f4faf6]"><span>{template}</span><CheckCircle2 className="mr-2 h-4 w-4 shrink-0 text-[#1d5a4d]" /></Button>)}</div></div> : null}
  </section>;
}
