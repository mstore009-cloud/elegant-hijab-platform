import { useEffect, useRef } from "react";
import { getSessionAuthorizationHeader } from "@/lib/sessionAuth";

type InboxLiveUpdatesOptions = {
  enabled: boolean;
  onInboxMessage: () => void;
};

function processFrames(buffer: string, onInboxMessage: (eventId: number) => void) {
  const frames = buffer.split("\n\n");
  const remainder = frames.pop() ?? "";
  for (const frame of frames) {
    if (!frame || frame.startsWith(":")) continue;
    const event = frame.split("\n").find(line => line.startsWith("event:"))?.slice(6).trim();
    const rawData = frame.split("\n").find(line => line.startsWith("data:"))?.slice(5).trim();
    if (event !== "inbox_message" || !rawData) continue;
    try {
      const data = JSON.parse(rawData) as { id?: unknown };
      const eventId = Number(data.id);
      if (Number.isSafeInteger(eventId) && eventId > 0) onInboxMessage(eventId);
    } catch {
      // Ignore malformed stream frames; the fallback refresh keeps Inbox consistent.
    }
  }
  return remainder;
}

export function useInboxLiveUpdates({ enabled, onInboxMessage }: InboxLiveUpdatesOptions) {
  const messageCallback = useRef(onInboxMessage);
  messageCallback.current = onInboxMessage;

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let reconnectTimer: number | undefined;
    let controller: AbortController | undefined;
    let lastEventId: number | null = null;

    const reconnect = () => {
      if (stopped) return;
      reconnectTimer = window.setTimeout(() => { void connect(); }, 1_000);
    };

    const connect = async () => {
      controller = new AbortController();
      let shouldReconnect = true;
      try {
        const after = lastEventId ?? "latest";
        const response = await fetch(`/api/inbox/live?after=${encodeURIComponent(String(after))}`, {
          method: "GET",
          headers: { Accept: "text/event-stream", ...getSessionAuthorizationHeader() },
          credentials: "include",
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          shouldReconnect = false;
          return;
        }
        if (!response.ok || !response.body) throw new Error("Inbox live stream unavailable");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = processFrames(buffer, eventId => {
            lastEventId = eventId;
            messageCallback.current();
          });
        }
      } catch (error) {
        if (!stopped && !controller.signal.aborted) console.warn("[InboxLive] تعذر استمرار التحديث الحي؛ ستبقى المزامنة الاحتياطية فعالة.", error);
      } finally {
        if (!stopped && shouldReconnect) reconnect();
      }
    };

    void connect();
    return () => {
      stopped = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      controller?.abort();
    };
  }, [enabled]);
}
