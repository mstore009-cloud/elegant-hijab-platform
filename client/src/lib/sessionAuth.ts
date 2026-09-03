import { COOKIE_NAME } from "@/const";

/** Returns the preview bearer fallback without exposing a session token in a URL. */
export function getSessionAuthorizationHeader(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem("manus-cookie");
    if (!raw) return {};
    const prefix = `${COOKIE_NAME}=`;
    const pair = raw.split(";").find(value => value.trim().startsWith(prefix));
    const token = pair?.trim().slice(prefix.length);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
