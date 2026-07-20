"use client";

import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { resolveStreamPlayback } from "@/lib/media";

type PlaybackState = "loading" | "ready" | "error";

export function StreamPlayer({
  streamId,
  label,
  fallback,
}: {
  streamId: string;
  label: string;
  fallback: ReactNode;
}) {
  const playback = useMemo(() => resolveStreamPlayback(streamId), [streamId]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlaybackState>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (playback.kind === "fallback") return;

    const video = videoRef.current;
    if (!video) return;

    if (playback.kind === "video" || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playback.url;
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }

    let disposed = false;
    let player: { destroy: () => void } | null = null;

    void import("hls.js")
      .then(({ default: Hls }) => {
        if (disposed) return;
        if (!Hls.isSupported()) {
          setState("error");
          return;
        }

        const hls = new Hls({
          backBufferLength: 30,
          enableWorker: true,
          lowLatencyMode: true,
        });
        player = hls;
        hls.loadSource(playback.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) setState("error");
        });
      })
      .catch(() => {
        if (!disposed) setState("error");
      });

    return () => {
      disposed = true;
      player?.destroy();
    };
  }, [attempt, playback]);

  if (playback.kind === "fallback") return fallback;

  return (
    <div className="absolute inset-0">
      {fallback}
      <video
        ref={videoRef}
        className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ${state === "ready" ? "opacity-100" : "opacity-0"}`}
        aria-label={`Processed live stream of ${label}`}
        autoPlay
        muted
        playsInline
        preload="metadata"
        onCanPlay={() => setState("ready")}
        onPlaying={() => setState("ready")}
        onError={() => setState("error")}
      />
      {state === "loading" && (
        <div className="absolute right-4 top-4 flex items-center gap-2 rounded-control bg-background/80 px-3 py-2 text-xs font-semibold backdrop-blur-md" role="status">
          <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
          Loading processed feed
        </div>
      )}
      {state === "error" && (
        <div className="absolute right-4 top-4 max-w-72 rounded-control border border-border bg-background/90 p-3 backdrop-blur-md" role="status">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold">Sensor view active</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">The processed video feed is temporarily unavailable.</p>
            </div>
          </div>
          <button
            className="focus-ring mt-2 inline-flex min-h-10 items-center gap-2 rounded-control px-2 text-xs font-semibold text-foreground hover:bg-surface-soft"
            type="button"
            onClick={() => {
              setState("loading");
              setAttempt((value) => value + 1);
            }}
          >
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry video
          </button>
        </div>
      )}
    </div>
  );
}
