'use client'


import { Suspense, useEffect, useRef } from "react";
import Login from "./components/Login";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

function SearchParamsHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const error = searchParams.get("error");

    if (error === "ALREADY_EXISTS_WITH_EMAIL") {
      toast.error("This email is registered via OTP. Please login with Email.");
      router.replace("/");
    } else if (error === "ALREADY_EXISTS_WITH_GOOGLE") {
      toast.error("This email is registered via Google. Please login with Google.");
      router.replace("/");
    }
  }, [searchParams, router]);

  return null;
}

export default function HomePage() {
  const sceneRef = useRef<HTMLDivElement>(null);

  const starPositions: [number, number][] = [
    [6, 14], [14, 7], [28, 11], [42, 6], [55, 16], [63, 10],
    [9, 26], [21, 32], [37, 22], [49, 29], [61, 25],
    [3, 40], [18, 45], [33, 37], [47, 43], [67, 38],
    [7, 55], [25, 58], [43, 52], [57, 56], [71, 50],
    [12, 68], [30, 72], [45, 65], [62, 70], [78, 63],
    [5, 80], [22, 84], [40, 77], [58, 82], [74, 75],
    [15, 91], [35, 88], [52, 93], [69, 86], [82, 90],
  ];

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const created: HTMLDivElement[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];

    // ── Stars ──
    starPositions.forEach(([xp, yp]) => {
      const s = document.createElement("div");
      const r = 0.6 + Math.random() * 1.2;
      s.style.cssText = `
        position:absolute;
        border-radius:50%;
        background:#fff;
        left:${xp}%;top:${yp}%;
        width:${r}px;height:${r}px;
        opacity:${0.15 + Math.random() * 0.6};
        animation:twinkle ${2 + Math.random() * 3}s ease-in-out infinite;
        animation-delay:${Math.random() * 4}s;
      `;
      scene.appendChild(s);
      created.push(s);
    });

    // ── Petals ──
    function makePetal() {
      if (!scene) return;
      const p = document.createElement("div");

      const xp = 5 + Math.random() * 90;
      const size = 7 + Math.random() * 18;
      const dx = (-70 + Math.random() * 140) + "px";
      const rot = (180 + Math.random() * 360) + "deg";
      const dur = 7 + Math.random() * 9;
      const delay = Math.random() * 6;
      const op = 0.2 + Math.random() * 0.55;
      const sc = 0.7 + Math.random() * 1.0;
      const hue = 335 + Math.random() * 25;
      const sat = 35 + Math.random() * 35;
      const lit = 58 + Math.random() * 22;

      p.style.cssText = `
        position:absolute;
        border-radius:50% 0 50% 0;
        opacity:0;
        animation:drift linear infinite;
        left:${xp}%;top:-40px;
        width:${size}px;height:${size * 0.55}px;
        background:hsl(${hue},${sat}%,${lit}%);
        --op:${op};--dx:${dx};--rot:${rot};--sc:${sc};
        animation-duration:${dur}s;
        animation-delay:${delay}s;
        filter:blur(${Math.random() < 0.25 ? 0.6 : 0}px);
      `;

      scene.appendChild(p);
      const t = setTimeout(() => p.remove(), (dur + delay) * 1000 + 800);
      timers.push(t);
    }

    // Initial burst + steady flow
    for (let i = 0; i < 30; i++) {
      const t = setTimeout(makePetal, i * 250);
      timers.push(t);
    }
    const interval = setInterval(makePetal, 380);

    return () => {
      created.forEach((el) => el.remove());
      timers.forEach(clearTimeout);
      clearInterval(interval);
    };
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <SearchParamsHandler />
      </Suspense>
      <style>{`
  /* Hide scrollbars for the entire page while this component is mounted */
  html, body {
    overflow: hidden !important;
    height: 100%;
    margin: 0;
    padding: 0;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none;  /* IE and Edge */
  }

  html::-webkit-scrollbar, 
  body::-webkit-scrollbar {
    display: none; /* Chrome, Safari, and Opera */
  }

  @keyframes drift {
    0%   { transform: translateY(-60px) translateX(0px) rotate(0deg) scale(0.4); opacity: 0; }
    8%   { opacity: var(--op); }
    85%  { opacity: var(--op); }
    100% { transform: translateY(110vh) translateX(var(--dx)) rotate(var(--rot)) scale(var(--sc)); opacity: 0; }
  }
  @keyframes twinkle {
    0%, 100% { opacity: 0.2; }
    50%       { opacity: 0.9; }
  }

  .hero-glow {
        position: absolute;
        width: 40vw;
        height: 40vw;
        background: radial-gradient(circle, rgba(210,140,160,0.15) 0%, transparent 70%);
        top: 20%;
        left: 10%;
        z-index: 5;
        filter: blur(80px);
        pointer-events: none;
      }
`}</style>

<div
      ref={sceneRef}
      className="relative w-screen h-screen bg-[#020005] overflow-hidden"
      style={{ fontFamily: "'Geist Sans', sans-serif" }}
    >
      <div className="hero-glow" />

      {/* Nav - Minimalist */}
      <nav className="absolute top-0 w-full flex justify-between items-center px-12 py-8 z-50">
        <div className="text-xl tracking-[0.2em] font-light text-white/90">
          Omni<span className="font-bold text-[rgba(210,140,160,0.9)]">Mind</span>
        </div>
        <div className="flex gap-8 items-center">
           {/* <button className="text-[10px] uppercase tracking-widest text-white/40 hover:text-white transition-colors">Documentation</button>
           <button className="bg-white/5 border border-white/10 px-5 py-2 rounded-full text-[10px] uppercase tracking-widest text-white hover:bg-white/10 transition-all">
             GitHub
           </button> */}
        </div>
      </nav>

      {/* Main Content Container */}
      <main className="relative z-20 h-full w-full max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-2 items-center px-12">
        
        {/* Left Side: The Narrative */}
        <div className="flex flex-col space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[rgba(210,140,160,0.3)] bg-[rgba(210,140,160,0.05)]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[rgba(210,140,160,0.6)] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[rgba(210,140,160,0.9)]"></span>
              </span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-[rgba(210,140,160,0.9)]">CodeSense v2.0 Live</span>
            </div>
            
            <h1 className="text-6xl xl:text-8xl font-extralight text-white leading-[0.9] tracking-tighter">
              Decoding <br />
              <span className="font-semibold bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-[rgba(210,140,160,0.8)]">
                Complexity.
              </span>
            </h1>
          </div>

          <p className="max-w-md text-lg text-white/50 leading-relaxed font-light">
            A high-precision RAG engine for the modern engineer. Transform static technical documentation into interactive, code-aware intelligence.
          </p>

          <div className="flex gap-4 pt-4">
             <div className="h-[1px] w-12 bg-[rgba(210,140,160,0.5)] self-center" />
             <span className="text-[11px] uppercase tracking-[0.3em] text-white/30 italic">Built for B.Tech CSE Workflows</span>
          </div>
        </div>

        {/* Right Side: The Access Point */}
        <div className="flex justify-center lg:justify-end">
          <div className="relative group">
            {/* Soft pulse behind the login box */}
            <div className="absolute -inset-1 bg-gradient-to-r from-[rgba(210,140,160,0.2)] to-transparent rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
            <Suspense fallback={null}>
              <Login />
            </Suspense>
          </div>
        </div>
      </main>

      {/* Decorative Floor */}
      <div className="absolute bottom-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
    </div>
    </>
  );
}