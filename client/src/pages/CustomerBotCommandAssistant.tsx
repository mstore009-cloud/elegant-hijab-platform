import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomerBotNav, SafetyNotice } from "@/components/customerBot/CustomerBotNav";
import TrainingCommandLibrary from "@/components/customerBot/TrainingCommandLibrary";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Archive, AudioLines, CheckCircle2, CircleAlert, FileAudio, Loader2, Mic, MicOff, Pencil, Save, Send, Sparkles, WandSparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const categoryLabels: Record<string, string> = { dialect_style: "تحسين اللهجة والنبرة", reply_example: "مثال رد", knowledge: "بطاقة معرفة", sales_playbook: "إجراء بيع", test_case: "حالة اختبار", guardrail: "حاجز أمان", knowledge_gap: "فجوة معرفة" };
const statusLabels: Record<string, string> = { transcribed: "بانتظار التفسير", needs_clarification: "يحتاج توضيحاً", previewed: "جاهز للمراجعة", saved_draft: "حُفظ مسودة", cancelled: "ملغي", failed: "تعذر التحويل" };

function parseJson(value: string | null) { try { return value ? JSON.parse(value) : null; } catch { return null; } }

export default function CustomerBotCommandAssistant({ embedded = false, canManageOverride }: { embedded?: boolean; canManageOverride?: boolean }) {
  const profile = trpc.access.myProfile.useQuery(undefined, { enabled: canManageOverride === undefined, staleTime: 60_000 });
  const canManage = canManageOverride ?? (profile.data?.permissions.includes("bot.manage") ?? false);
  const commands = trpc.customerBot.commandRequests.useQuery(undefined, { enabled: canManage });
  const [text, setText] = useState("");
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const utils = trpc.useUtils();
  const interpretText = trpc.customerBot.createTextCommand.useMutation({ onSuccess: async result => { setText(""); setEditing(false); await utils.customerBot.commandRequests.invalidate(); setSelected(result.command.id); toast.success("فهم المساعد الأمر وقدم تغييراً مقترحاً. راجعيه قبل الحفظ."); }, onError: error => toast.error(error.message) });
  const updateText = trpc.customerBot.updateTextCommand.useMutation({ onSuccess: async result => { setEditing(false); await utils.customerBot.commandRequests.invalidate(); setSelected(result.command.id); toast.success("تم تحديث الأمر وإعادة تفسيره دون إنشاء سجل جديد."); }, onError: error => toast.error(error.message) });
  const archiveCommand = trpc.customerBot.archiveCommand.useMutation({ onSuccess: async (_result, input) => { await utils.customerBot.commandRequests.invalidate(); if (selected === input.commandId) { setSelected(null); setEditing(false); setText(""); } toast.success("تمت أرشفة الأمر وإخفاؤه من القائمة."); }, onError: error => toast.error(error.message) });
  const interpretAudio = trpc.customerBot.createAudioCommand.useMutation({ onSuccess: async result => { await utils.customerBot.commandRequests.invalidate(); setSelected(result.command.id); toast.success(result.classification ? "حُوّل الصوت إلى نص وتغيير مقترح." : "حُفظ التسجيل لكن يحتاج مراجعة بسبب تعذر التحويل."); }, onError: error => toast.error(error.message) });
  const selectedCommand = useMemo(() => commands.data?.find(command => command.id === selected) ?? commands.data?.[0] ?? null, [commands.data, selected]);
  const classification = parseJson(selectedCommand?.classificationJson ?? null);
  const [draftCategory, setDraftCategory] = useState("dialect_style");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [editedTranscript, setEditedTranscript] = useState("");
  const saveDraft = trpc.customerBot.saveCommandAsProposal.useMutation({ onSuccess: async () => { await Promise.all([utils.customerBot.commandRequests.invalidate(), utils.customerBot.learningProposals.invalidate()]); toast.success("حُفظ التفسير كمسودة تعليمية في القسم المناسب."); }, onError: error => toast.error(error.message) });

  useEffect(() => {
    if (!selectedCommand) return;
    const next = parseJson(selectedCommand.proposedChangeJson ?? null);
    setDraftCategory(next?.category && categoryLabels[next.category] ? next.category : "dialect_style");
    setDraftTitle(next?.title ?? "");
    setDraftBody(next?.body ?? "");
    setEditedTranscript(selectedCommand.inputType === "audio" ? selectedCommand.transcript ?? "" : "");
  }, [selectedCommand?.id]);

  function selectCommand(id: number) {
    const command = commands.data?.find(item => item.id === id);
    const next = parseJson(command?.proposedChangeJson ?? null);
    setSelected(id);
    setText(command?.originalText || command?.transcript || "");
    setEditing(false);
    setDraftCategory(next?.category && categoryLabels[next.category] ? next.category : "dialect_style");
    setDraftTitle(next?.title ?? "");
    setDraftBody(next?.body ?? "");
    setEditedTranscript(command?.inputType === "audio" ? command.transcript ?? "" : "");
  }

  function beginEditing() {
    if (!selectedCommand) return;
    setText(selectedCommand.originalText || selectedCommand.transcript || "");
    setEditing(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function submitTextCommand() {
    if (!text.trim()) return;
    if (editing && selectedCommand) updateText.mutate({ commandId: selectedCommand.id, text });
    else interpretText.mutate({ text });
  }

  function saveEditedTranscriptAsKnowledge() {
    if (!selectedCommand || !editedTranscript.trim()) {
      toast.error("عدّلي النص المستخرج أو اكتبيه أولاً.");
      return;
    }
    saveDraft.mutate({ commandId: selectedCommand.id, category: "knowledge", title: draftTitle.trim() || "بطاقة معرفة من تسجيل صوتي", body: editedTranscript.trim() });
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { toast.error("التسجيل الصوتي غير مدعوم في هذا المتصفح. استخدمي رفع ملف صوتي بدلاً من ذلك."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined });
      chunks.current = [];
      mediaRecorder.ondataavailable = event => { if (event.data.size) chunks.current.push(event.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        const format = (mediaRecorder.mimeType || "audio/webm").split(";", 1)[0].split("/").pop() || "webm";
        const extension = format === "mpeg" ? "mp3" : format === "mp4" ? "m4a" : format;
        void sendAudio(blob, `voice-command.${extension}`);
      };
      recorder.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
    } catch { toast.error("تعذر الوصول إلى الميكروفون. تحققي من إذن المتصفح."); }
  }
  function stopRecording() { recorder.current?.stop(); recorder.current = null; setRecording(false); }
  async function sendAudio(file: Blob, fileName: string) {
    if (file.size > 16 * 1024 * 1024) { toast.error("الحد الأقصى للتسجيل 16 ميغابايت."); return; }
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer); let binary = ""; bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    interpretAudio.mutate({ fileName, mimeType: file.type || "audio/webm", base64: btoa(binary) });
  }

  if (profile.isLoading || (canManage && commands.isLoading)) return <div className="p-8 text-sm text-muted-foreground">جارٍ تحميل مساعد الأوامر…</div>;
  if (!canManage) return <div className="p-8 text-center">لا توجد صلاحية لإدارة مساعد الأوامر.</div>;

  return <main dir="rtl" className={embedded ? "space-y-5" : "mx-auto max-w-6xl space-y-5 pb-10"}>
    {!embedded ? <CustomerBotNav title="مساعد إعداد البوت" description="اكتبي أو تحدثي، أو اختاري قالباً من المكتبة، وسيشرح المساعد ما فهمه وأين سيحفظ التغيير. لا ينفذ شيئاً من دون مراجعتك وحفظه كمسودة." /> : null}
    {!embedded ? <SafetyNotice /> : null}
    <TrainingCommandLibrary onUseTemplate={template => { setText(template); toast.success("تم وضع القالب في المحرر. عدّليه ثم اضغطي فهم الأمر."); }} />
    <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-2xl border border-[#e2e8e3] bg-white p-5 shadow-[0_10px_24px_rgba(41,63,53,0.05)]"><div className="flex items-start gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#f1ebfa] text-[#7048a5]"><WandSparkles className="h-5 w-5" /></span><div><h2 className="font-bold text-[#31483d]">قولي ما تريدين أن يتعلمه البوت</h2><p className="mt-1 text-sm leading-6 text-[#74817a]">مثال: «إذا سألت الزبونة عن الألوان بعد قراءة الكود، اقترح صور الألوان أولاً» أو «لا يذكر البوت أنه ذكاء اصطناعي».</p></div></div>{editing ? <p className="mt-4 rounded-lg bg-[#eef7f0] px-3 py-2 text-xs text-[#35604a]">أنتِ تعدلين الأمر المحدد. سيُحدّث التفسير نفسه ولن يُنشأ أمر جديد.</p> : null}<Textarea value={text} onChange={event => setText(event.target.value)} className="mt-5 min-h-36 rounded-xl" placeholder="اكتبي أمرك بلغة طبيعية…" /><div className="mt-3 flex flex-wrap items-center gap-2"><Button disabled={!text.trim() || interpretText.isPending || updateText.isPending} onClick={submitTextCommand} className="rounded-xl bg-[#1d5a4d] hover:bg-[#153f36]">{interpretText.isPending || updateText.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Send className="ml-2 h-4 w-4" />}{editing ? "تحديث وفهم الأمر" : "فهم الأمر"}</Button>{editing ? <Button type="button" variant="outline" onClick={() => { setEditing(false); setText(""); }} className="rounded-xl">إلغاء التعديل</Button> : null}<Button type="button" variant={recording ? "destructive" : "outline"} onClick={recording ? stopRecording : startRecording} disabled={interpretAudio.isPending} className="rounded-xl">{recording ? <MicOff className="ml-2 h-4 w-4" /> : <Mic className="ml-2 h-4 w-4" />}{recording ? "إيقاف وإرسال التسجيل" : interpretAudio.isPending ? "جارٍ تحويل الصوت…" : "تسجيل أمر صوتي"}</Button><label className="inline-flex h-9 cursor-pointer items-center rounded-xl border border-input bg-background px-3 text-xs font-medium hover:bg-accent"><input type="file" accept=".mp3,.wav,.m4a,.ogg,.webm,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/mp4,audio/m4a,audio/x-m4a" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void sendAudio(file, file.name); }} /><FileAudio className="ml-1.5 h-3.5 w-3.5" />رفع تسجيل</label></div><p className="mt-3 rounded-xl bg-[#fffaf2] px-3 py-2 text-xs leading-5 text-[#8b6a35]">ستظهر نسخة النص المستخرج أولاً، ثم التفسير المقترح. لا يُشغّل المساعد القنوات ولا يغيّر السعر أو المخزون أو الطلب من أمر حر.</p></section>
      <aside className="rounded-2xl border border-[#e2e8e3] bg-white p-4 shadow-[0_10px_24px_rgba(41,63,53,0.05)]"><h2 className="font-bold text-[#31483d]">الأوامر الأخيرة</h2><div className="mt-3 max-h-[320px] space-y-2 overflow-auto">{commands.data?.length ? commands.data.map(command => <div key={command.id} role="button" tabIndex={0} onClick={() => selectCommand(command.id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") selectCommand(command.id); }} className={`w-full cursor-pointer rounded-xl border p-3 text-right transition ${selectedCommand?.id === command.id ? "border-[#bcd6c5] bg-[#f4faf6]" : "border-[#ecefe9] hover:bg-muted/50"}`}><div className="flex items-center justify-between gap-2"><Badge className="bg-[#eff4f0] text-[#4a6255]">{command.inputType === "audio" ? "صوتي" : "كتابي"}</Badge><div className="flex items-center gap-2"><span className="text-[10px] text-muted-foreground">{statusLabels[command.status]}</span><button type="button" title="أرشفة الأمر" className="rounded-md p-1 text-muted-foreground hover:bg-rose-50 hover:text-rose-700" onClick={event => { event.stopPropagation(); if (window.confirm("هل تريدين إخفاء هذا الأمر من القائمة؟ لن تتأثر أي مسودة تعليمية محفوظة.")) archiveCommand.mutate({ commandId: command.id }); }}><Archive className="h-3.5 w-3.5" /></button></div></div><p className="mt-2 line-clamp-2 text-xs leading-5 text-[#52645a]">{command.transcript || command.originalText || command.errorSummary || "لا يوجد نص"}</p>{selectedCommand?.id === command.id ? <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#1d5a4d] hover:underline" onClick={event => { event.stopPropagation(); beginEditing(); }}><Pencil className="h-3 w-3" />تعديل الأمر</button> : null}</div>) : <p className="py-8 text-center text-xs text-muted-foreground">لم تسجلي أمراً بعد.</p>}</div></aside>
    </section>
    {selectedCommand ? <section className="rounded-2xl border border-[#e2e8e3] bg-white p-5 shadow-[0_10px_24px_rgba(41,63,53,0.05)]"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="flex items-center gap-2 font-bold text-[#31483d]"><AudioLines className="h-4 w-4 text-[#7048a5]" />تفسير الأمر وتغيير مقترح</h2><p className="mt-1 text-sm text-[#74817a]">راجعي التفسير وعدّلي الوجهة أو المحتوى قبل حفظ المسودة.</p></div><Badge className={selectedCommand.status === "needs_clarification" ? "bg-amber-50 text-amber-800" : selectedCommand.status === "failed" ? "bg-rose-50 text-rose-800" : "bg-emerald-50 text-emerald-800"}>{statusLabels[selectedCommand.status]}</Badge></div>{selectedCommand.inputType === "audio" ? <div className="mt-4 rounded-xl border border-dashed bg-[#fafcf9] p-4"><div className="flex items-center justify-between gap-3"><Label className="text-[11px] font-bold text-[#64776a]">النص المستخرج — راجعيه وعدّليه قبل الحفظ</Label><Badge variant="outline" className="text-[10px]">مراجعة يدوية</Badge></div><Textarea value={editedTranscript} onChange={event => setEditedTranscript(event.target.value)} className="mt-2 min-h-32 bg-white leading-7" placeholder="سيظهر النص المستخرج من التسجيل هنا…" /><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p className="text-xs leading-5 text-[#74817a]">سيُحفظ النص المعدل كمسودة بطاقة معرفة، ولن يُعتمد تلقائياً في ردود البوت.</p><Button type="button" disabled={!editedTranscript.trim() || saveDraft.isPending || selectedCommand.status === "saved_draft"} onClick={saveEditedTranscriptAsKnowledge} className="rounded-xl bg-[#1d5a4d] hover:bg-[#153f36]">{saveDraft.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}{selectedCommand.status === "saved_draft" ? "حُفظت المسودة" : "حفظ كبطاقة معرفة"}</Button></div></div> : null}{classification ? <div className="mt-4 rounded-xl bg-[#f5f9f6] p-4"><p className="text-xs font-bold text-[#456451]">فهم المساعد</p><p className="mt-1 text-sm leading-6 text-[#405a4b]">{classification.explanation}</p>{classification.warning ? <p className="mt-3 flex gap-2 rounded-lg bg-[#fff4e9] p-2 text-xs leading-5 text-[#93612e]"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />{classification.warning}</p> : null}{classification.clarificationQuestion ? <p className="mt-3 rounded-lg border border-dashed bg-white p-2 text-xs text-[#6f6045]">يحتاج توضيحاً: {classification.clarificationQuestion}</p> : null}</div> : <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{selectedCommand.errorSummary || "لم يتمكن المساعد من تفسير هذا الأمر."}</p>}
      {classification?.destination !== "clarification" ? <div className="mt-5 grid gap-4 lg:grid-cols-2"><div><Label>مكان الحفظ</Label><Select value={draftCategory} onValueChange={setDraftCategory}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div><Label>عنوان المسودة</Label><Input value={draftTitle} onChange={event => setDraftTitle(event.target.value)} className="mt-2" /></div><div className="lg:col-span-2"><Label>المحتوى القابل للمراجعة</Label><Textarea value={draftBody} onChange={event => setDraftBody(event.target.value)} className="mt-2 min-h-32" /></div><div className="lg:col-span-2 flex justify-end"><Button disabled={!draftTitle.trim() || !draftBody.trim() || saveDraft.isPending || selectedCommand.status === "saved_draft"} onClick={() => saveDraft.mutate({ commandId: selectedCommand.id, category: draftCategory as any, title: draftTitle, body: draftBody })} className="rounded-xl bg-[#1d5a4d] hover:bg-[#153f36]">{saveDraft.isPending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Save className="ml-2 h-4 w-4" />}{selectedCommand.status === "saved_draft" ? "حُفظت المسودة" : "حفظ كمسودة تعليمية"}</Button></div></div> : null}</section> : null}
  </main>;
}
