import { describe, expect, it } from "vitest";
import { normalizeAudioMimeType } from "./playground";

describe("Customer Bot audio command formats", () => {
  it("accepts MediaRecorder MIME parameters such as audio/webm;codecs=opus", () => {
    expect(normalizeAudioMimeType("audio/webm;codecs=opus", "voice-command.webm")).toBe("audio/webm");
  });

  it("normalizes supported aliases and extensions", () => {
    expect(normalizeAudioMimeType("audio/x-wav", "recording.wav")).toBe("audio/wav");
    expect(normalizeAudioMimeType("audio/m4a", "recording.m4a")).toBe("audio/mp4");
    expect(normalizeAudioMimeType("", "recording.mp3")).toBe("audio/mpeg");
  });

  it("does not accept video MIME types merely because the extension is webm", () => {
    expect(normalizeAudioMimeType("video/webm", "recording.webm")).toBeNull();
  });

  it("rejects unsupported formats", () => {
    expect(normalizeAudioMimeType("image/webp", "recording.webp")).toBeNull();
    expect(normalizeAudioMimeType("application/pdf", "recording.pdf")).toBeNull();
  });
});
