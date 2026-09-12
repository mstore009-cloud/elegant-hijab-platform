import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bot, BookOpenText, ClipboardCheck, MessageSquareText, Settings2, Sparkles } from "lucide-react";
import { useLocation } from "wouter";

const items = [
  { path: "/customer-bot", label: "نظرة عامة", icon: Bot },
  { path: "/customer-bot/playground", label: "مختبر المحادثة", icon: MessageSquareText },
  { path: "/customer-bot/learning", label: "المعرفة والتعلم", icon: BookOpenText },
  { path: "/customer-bot/testing", label: "الاختبارات والمسودات", icon: ClipboardCheck },
  { path: "/customer-bot/settings", label: "إعدادات التشغيل", icon: Settings2 },
];

export function CustomerBotNav({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  return <>
    <header dir="rtl" className="overflow-hidden rounded-[1.75rem] border border-[#e4dfd1] bg-[radial-gradient(circle_at_91%_0%,#f4e8cd,transparent_33%),linear-gradient(135deg,#fffdf9,#f6f8f3)] px-5 py-6 shadow-[0_10px_28px_rgba(41,63,53,0.06)] sm:px-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold tracking-[0.13em] text-[#9a7b3e]"><Sparkles className="h-3.5 w-3.5" /> CUSTOMER BOT CENTER</p>
          <h1 className="mt-2 text-2xl font-bold text-[#233a33]">{title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6d7a72]">{description}</p>
        </div>
        {action}
      </div>
      <nav aria-label="أقسام مركز البوت" className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {items.map(item => {
          const Icon = item.icon;
          const active = location.split("?")[0] === item.path;
          return <Button key={item.path} type="button" size="sm" variant={active ? "default" : "outline"} onClick={() => setLocation(item.path)} className={active ? "shrink-0 rounded-xl bg-[#1d5a4d] text-white hover:bg-[#153f36]" : "shrink-0 rounded-xl border-[#d9e3dc] bg-white/80 text-[#496154] hover:bg-[#eef5f0]"}>
            <Icon className="ml-1.5 h-3.5 w-3.5" />{item.label}
          </Button>;
        })}
      </nav>
    </header>
  </>;
}

export function SafetyNotice() {
  return <div dir="rtl" className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-900">
    <Badge className="bg-emerald-700 text-white">آمن</Badge>
    <span>المختبر والأوامر يحفظان مسودات فقط: لا إرسال إلى Meta، لا تعديل CRM، ولا إنشاء طلب نهائي.</span>
  </div>;
}
