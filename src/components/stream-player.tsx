"use client";

import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ResolvedStream } from "@/app/api/streams/[marketId]/route";

type PlaybackState = "resolving" | "loading" | "ready" | "error";

export type StreamSource = { url: string; name: string };

const maximumRetries = 3;

// What the picture opens at. 3 Mbit covers 720p on these streams and is well
// inside what a normal connection carries, so the first frames are watchable
// and the player still climbs to 1080p from there.
const openingBitrate = 3_000_000;

export function StreamPlayer({
  marketId,
  label,
  fallback,
  onSourceChange,
}: {
  marketId: string;
  label: string;
  fallback: ReactNode;
  onSourceChange?: (source: ResolvedStream | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlaybackState>("resolving");
  const [stream, setStream] = useState<ResolvedStream | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retries = useRef(0);

  useEffect(() => {
    onSourceChange?.(stream);
  }, [stream, onSourceChange]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void fetch(`/api/streams/${encodeURIComponent(marketId)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("resolve failed"))))
      .then((resolved: ResolvedStream) => {
        if (!active) return;
        // An empty url means no camera behind this market is reachable. There is
        // no recorded stand-in to show, so say so rather than play something
        // that was never observed.
        if (!resolved.url) {
          setState("error");
          return;
        }
        setStream(resolved);
        setState("loading");
      })
      .catch(() => {
        if (active) setState("error");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [marketId, attempt]);

  const retry = useCallback(() => {
    if (retries.current >= maximumRetries) {
      setState("error");
      return;
    }
    retries.current += 1;
    setState("resolving");
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!stream) return;
    const video = videoRef.current;
    if (!video) return;

    if (stream.kind === "video" || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = stream.url;
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
          // These manifests list 144p first, and hls.js starts from a 500kbit
          // guess, so the picture opened at 256x144 and crawled upwards for the
          // best part of a minute. The proxy measures 13Mbit against the 5.5
          // that 1080p asks for, so the first guess was wrong by twenty times.
          abrEwmaDefaultEstimate: 8_000_000,
          // Off: none of these are low latency HLS, and asking for it made the
          // player chase a live edge the manifest does not publish.
          lowLatencyMode: false,
        });
        player = hls;

        // Start partway up the ladder rather than at the bottom. Left to pick
        // for itself the player opened at 256x144 and took forty seconds to
        // reach 1080p, which is most of a market's opening minute spent looking
        // like a webcam from 2004. Chosen by bitrate, not by index, because a
        // stream with three renditions and one with eight do not number them
        // the same.
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          const affordable = data.levels
            .map((level, index) => ({ index, bitrate: level.bitrate }))
            .filter((level) => level.bitrate <= openingBitrate);
          if (affordable.length > 0) {
            hls.startLevel = affordable[affordable.length - 1].index;
          }
        });

        hls.loadSource(stream.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) retry();
        });
      })
      .catch(() => {
        if (!disposed) setState("error");
      });

    return () => {
      disposed = true;
      player?.destroy();
    };
  }, [stream, retry]);

  return (
    <div className="absolute inset-0">
      {fallback}
      <video
        ref={videoRef}
        className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${state === "ready" ? "opacity-100" : "opacity-0"}`}
        aria-label={`Processed live stream of ${label}`}
        poster={stream?.poster}
        autoPlay
        muted
        loop={stream?.kind === "video"}
        playsInline
        preload="metadata"
        onCanPlay={() => setState("ready")}
        onPlaying={() => setState("ready")}
        onError={retry}
      />

      {(state === "resolving" || state === "loading") && (
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-black/60 px-4 py-2 backdrop-blur-sm" role="status">
          <LoaderCircle className="size-4 animate-spin text-white/70" aria-hidden="true" />
          <span className="text-xs text-white/70">
            {state === "resolving" ? "Selecting a live source" : "Connecting"}
          </span>
        </div>
      )}

      {state === "error" && (
        <div className="absolute right-4 top-4 max-w-72 rounded-control border border-border bg-background/90 p-3 backdrop-blur-md" role="status">
          <div className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold">Sensor view active</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">No qualified source is reachable right now.</p>
            </div>
          </div>
          <button
            className="focus-ring mt-2 inline-flex min-h-10 items-center gap-2 rounded-control px-2 text-xs font-semibold text-foreground hover:bg-surface-soft"
            type="button"
            onClick={() => {
              retries.current = 0;
              setState("resolving");
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
