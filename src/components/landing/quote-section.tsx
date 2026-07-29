"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

function lerp(from: number, to: number, factor: number) {
  return from + (to - from) * factor;
}

export function QuoteSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const rainbowRef = useRef<HTMLDivElement>(null);
  const leftCloudRef = useRef<HTMLDivElement>(null);
  const rightCloudRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) {
      if (rainbowRef.current) rainbowRef.current.style.transform = "translate3d(0, -20px, 0)";
      if (leftCloudRef.current) {
        leftCloudRef.current.style.transform = "translate3d(0, 0, 0)";
        leftCloudRef.current.style.opacity = "1";
      }
      if (rightCloudRef.current) {
        rightCloudRef.current.style.transform = "translate3d(0, 0, 0)";
        rightCloudRef.current.style.opacity = "1";
      }
      return;
    }

    const state = { rainbowY: 120, leftX: -200, rightX: 200, cloudY: 0 };
    let frame = 0;

    function tick() {
      const section = sectionRef.current;
      if (section) {
        const rect = section.getBoundingClientRect();
        const viewport = window.innerHeight;
        const progress = Math.min(1, Math.max(0, (viewport - rect.top) / (viewport + rect.height)));
        const inView = progress > 0.12 && progress < 0.92;

        state.rainbowY = lerp(state.rainbowY, 120 - progress * 280, 0.06);
        state.cloudY = lerp(state.cloudY, progress * -50, 0.04);
        state.leftX = lerp(state.leftX, inView ? 0 : -200, 0.04);
        state.rightX = lerp(state.rightX, inView ? 0 : 200, 0.04);

        if (rainbowRef.current) {
          rainbowRef.current.style.transform = `translate3d(0, ${state.rainbowY.toFixed(2)}px, 0)`;
        }
        if (leftCloudRef.current) {
          leftCloudRef.current.style.transform = `translate3d(${state.leftX.toFixed(2)}px, ${state.cloudY.toFixed(2)}px, 0)`;
          leftCloudRef.current.style.opacity = Math.max(0, 1 - Math.abs(state.leftX) / 200).toFixed(3);
        }
        if (rightCloudRef.current) {
          rightCloudRef.current.style.transform = `translate3d(${state.rightX.toFixed(2)}px, ${state.cloudY.toFixed(2)}px, 0)`;
          rightCloudRef.current.style.opacity = Math.max(0, 1 - Math.abs(state.rightX) / 200).toFixed(3);
        }
      }
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <section ref={sectionRef} className="quote-sky relative -mt-px h-screen overflow-hidden" aria-labelledby="thesis-heading">
      <div
        ref={rainbowRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-30 will-change-transform"
        style={{ transform: "translate3d(0, 120px, 0)" }}
        aria-hidden="true"
      >
        <Image className="h-auto w-full" src="/landing/rainbow.webp" alt="" width={2400} height={932} priority={false} />
      </div>

      <div
        ref={leftCloudRef}
        className="pointer-events-none absolute bottom-[10%] left-0 z-10 hidden w-[500px] will-change-transform sm:block md:w-[650px]"
        style={{ marginLeft: "-50%", opacity: 0, transform: "translate3d(-200px, 0, 0)" }}
        aria-hidden="true"
      >
        <Image className="h-auto w-full" src="/landing/cloud.webp" alt="" width={1920} height={1130} />
      </div>

      <div
        ref={rightCloudRef}
        className="pointer-events-none absolute bottom-[15%] right-0 z-10 hidden w-[500px] scale-x-[-1] will-change-transform sm:block md:w-[650px]"
        style={{ marginRight: "-75%", opacity: 0, transform: "translate3d(200px, 0, 0)" }}
        aria-hidden="true"
      >
        <Image className="h-auto w-full" src="/landing/cloud.webp" alt="" width={1920} height={1130} />
      </div>

      <div className="relative z-20 flex h-full items-center justify-center px-6">
        <blockquote className="max-w-4xl text-center">
          <p
            id="thesis-heading"
            className="font-instrument text-xl leading-[1.45] text-white sm:text-2xl md:text-4xl md:leading-[1.5] lg:text-[42px]"
          >
            “Scry began from a simple belief: the physical world should be forecastable without being surveilled. Every
            market starts with a qualified stream and a question that can actually be measured. The rule is fixed before
            anyone forecasts, the observation window is fixed, and the result carries the evidence that produced it. No
            black boxes, no vibes — only what was observed, and how.”
          </p>
          <footer className="mt-6 text-sm tracking-wide text-white/80 md:mt-8 md:text-base">
            The Scry thesis — Proof of Observation
          </footer>
        </blockquote>
      </div>
    </section>
  );
}
