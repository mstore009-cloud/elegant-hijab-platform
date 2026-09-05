import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, FileText, Image as ImageIcon, Maximize2, Play, Sparkles } from "lucide-react";
import { useState } from "react";

type MediaItem = {
  id: number;
  url?: string | null;
  mediaType: "image" | "video" | "audio" | "document" | "unsupported" | string;
  originalFileName?: string | null;
  downloadStatus?: "stored" | "pending" | "failed" | string | null;
  analysis?: unknown;
};

type ViewerItem = MediaItem & { url: string };

function isViewable(item: MediaItem): item is ViewerItem {
  return Boolean(item.url) && (item.mediaType === "image" || item.mediaType === "video");
}

function viewerTitle(item: ViewerItem) {
  return item.mediaType === "video" ? "فيديو" : "صورة";
}

export function ThreadMedia({ items, outgoing, canAnalyze, analyzingMediaId, onAnalyze }: { items: MediaItem[]; outgoing: boolean; canAnalyze: boolean; analyzingMediaId: number | null; onAnalyze: (mediaId: number) => void }) {
  const [viewer, setViewer] = useState<ViewerItem | null>(null);
  const frame = outgoing ? "border-white/15 bg-black/10" : "border-[#e9e2d8] bg-[#faf8f5]";
  const iconTone = outgoing ? "text-white/85" : "text-[#596b62]";

  if (!items.length) return null;

  return <>
    <div className="mt-2.5 flex max-w-full flex-wrap gap-2">
      {items.map(item => {
        if (item.mediaType === "image" && item.url) {
          return <div key={item.id} className={`group relative overflow-hidden rounded-2xl border ${frame}`}>
            <button type="button" onClick={() => setViewer(item as ViewerItem)} className="block max-w-[min(360px,72vw)] overflow-hidden rounded-[0.9rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d694a0]" aria-label="فتح الصورة بالحجم الكامل">
              <img src={item.url} alt="صورة في المحادثة" className="max-h-[360px] w-full object-cover transition duration-200 group-hover:scale-[1.015]" loading="lazy" />
            </button>
            <button type="button" onClick={() => setViewer(item as ViewerItem)} className="absolute bottom-2 left-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100" aria-label="تكبير الصورة"><Maximize2 className="h-4 w-4" /></button>
            {canAnalyze && <button type="button" disabled={analyzingMediaId === item.id} onClick={() => onAnalyze(item.id)} className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-[#785b4a] shadow-sm transition hover:bg-white disabled:opacity-70" aria-label="تحليل الصورة" title="تحليل الصورة"><Sparkles className={`h-4 w-4 ${analyzingMediaId === item.id ? "animate-pulse" : ""}`} /></button>}
          </div>;
        }

        if (item.mediaType === "video" && item.url) {
          return <div key={item.id} className={`group relative w-full max-w-[420px] overflow-hidden rounded-2xl border ${frame}`}>
            <video src={item.url} controls preload="metadata" className="max-h-[360px] w-full bg-black" aria-label="فيديو في المحادثة" />
            <button type="button" onClick={() => setViewer(item as ViewerItem)} className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100`}><Maximize2 className="h-3.5 w-3.5" />عرض</button>
          </div>;
        }

        if (item.mediaType === "audio" && item.url) {
          return <div key={item.id} className={`w-full min-w-[230px] max-w-[360px] rounded-2xl border px-3 py-2.5 ${frame}`}>
            <audio src={item.url} controls preload="metadata" className="h-9 w-full" aria-label="رسالة صوتية" />
          </div>;
        }

        if (item.mediaType === "document" && item.url) {
          return <a key={item.id} href={item.url} target="_blank" rel="noreferrer" className={`flex min-w-[220px] max-w-[360px] items-center gap-3 rounded-2xl border px-3 py-3 transition hover:brightness-[.98] ${frame}`}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${outgoing ? "bg-white/15" : "bg-[#efe9e0]"}`}><FileText className={`h-4 w-4 ${iconTone}`} /></span>
            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{item.originalFileName || "ملف"}</span>
            <Download className={`h-4 w-4 shrink-0 ${iconTone}`} />
          </a>;
        }

        return <div key={item.id} className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs ${frame}`}><ImageIcon className={`h-4 w-4 ${iconTone}`} /><span>لا يمكن عرض هذا العنصر الآن.</span></div>;
      })}
    </div>

    <Dialog open={Boolean(viewer)} onOpenChange={open => { if (!open) setViewer(null); }}>
      <DialogContent dir="rtl" className="max-h-[92vh] max-w-5xl overflow-hidden border-[#29332e] bg-[#111614] p-0 text-white sm:rounded-2xl">
        {viewer && <>
          <DialogHeader className="absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/70 to-transparent px-5 py-4"><DialogTitle className="text-sm font-medium text-white/90">{viewerTitle(viewer)}</DialogTitle></DialogHeader>
          <div className="flex max-h-[92vh] min-h-[50vh] items-center justify-center bg-black">
            {viewer.mediaType === "image" ? <img src={viewer.url} alt="صورة بالحجم الكامل" className="max-h-[92vh] max-w-full object-contain" /> : <video src={viewer.url} controls autoPlay className="max-h-[88vh] max-w-full" aria-label="فيديو بالحجم الكامل" />}
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
