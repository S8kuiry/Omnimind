'use client'

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import LoginModal from "./components/Login";
import { useSession, signOut } from "next-auth/react";

function SearchParamsHandler({ onAuthError }: { onAuthError: (code: string) => void }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  
  useEffect(() => {
    const error = searchParams.get("error");
    if (!error) return;
    onAuthError(error);
    router.replace("/");
  }, [searchParams, router]);
  return null;
}

export default function HomePage() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const router = useRouter();

  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);
  const { data: session } = useSession();
  const isLoggedIn = !!session?.user;
  const userEmail = session?.user?.email ?? "user@node.cse";

  const handleLogin = () => {
    setIsAuthModalOpen(true); 
  };
  
  const handleLaunchApp = () => {
    if (isLoggedIn) {
      router.push("/dashboard");
    } else {
      setIsAuthModalOpen(true); // Open frame immediately if not authenticated
    }
  };

  const handleLogout = async () => {
    await signOut({ callbackUrl: "/" });
  };

  const starPositions: [number, number][] = [
    [6, 14], [14, 7], [28, 11], [42, 6], [55, 16], [63, 10],
    [9, 26], [21, 32], [37, 22], [49, 29], [61, 25],
    [3, 40], [18, 45], [33, 37], [47, 43], [67, 38],
    [7, 55], [25, 58], [43, 52], [57, 56], [71, 50],
    [12, 68], [30, 72], [45, 65], [62, 70], [78, 63],
    [5, 80], [22, 84], [40, 77], [58, 82], [74, 75],
    [15, 91], [35, 88], [52, 93], [69, 86], [82, 90],
  ];

  // ── Stars ───────────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const created: HTMLDivElement[] = [];
    starPositions.forEach(([xp, yp]) => {
      const s = document.createElement("div");
      const r = 0.6 + Math.random() * 1.2;
      s.style.cssText = `
        position:absolute;border-radius:50%;background:#fff;
        left:${xp}%;top:${yp}%;
        width:${r}px;height:${r}px;
        opacity:${0.12 + Math.random() * 0.5};
        animation:twinkle ${2 + Math.random() * 3}s ease-in-out infinite;
        animation-delay:${Math.random() * 4}s;
      `;
      scene.appendChild(s);
      created.push(s);
    });
    return () => created.forEach(el => el.remove());
  }, []);

  // ── Pixel block rain ────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const c = canvas;
    const g = ctx;

    const resize = () => {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const STYLES = [
      { br: 255, bg: 255, bb: 255, ba: 0.85, fr: 255, fg: 255, fb: 255, fa: 0.06 },
      { br: 255, bg: 255, bb: 255, ba: 0.65, fr: 255, fg: 255, fb: 255, fa: 0.04 },
      { br: 255, bg: 90,  bb: 150, ba: 0.90, fr: 255, fg: 90,  fb: 150, fa: 0.10 }, 
      { br: 255, bg: 120, bb: 180, ba: 0.78, fr: 255, fg: 120, fb: 180, fa: 0.08 }, 
      { br: 236, bg: 72,  bb: 153, ba: 0.82, fr: 236, fg: 72,  fb: 153, fa: 0.09 }, 
      { br: 244, bg: 63,  bb: 94,  ba: 0.78, fr: 244, fg: 63,  fb: 94,  fa: 0.08 }, 
      { br: 220, bg: 38,  bb: 38,  ba: 0.70, fr: 220, fg: 38,  fb: 38,  fa: 0.07 }, 
    ];

    const SIZES = [2, 2, 4, 4, 5, 6, 7, 8, 9, 10];
    const borderW = (sz: number) => Math.max(1, Math.round(sz * 0.12));

    type Pixel = {
      x: number; y: number;
      vx: number; vy: number;
      size: number;
      style: typeof STYLES[0];
      alpha: number;
      bounces: number; maxBounces: number;
      settled: boolean;
      settleFrames: number;
      alive: boolean;
    };

    const pool: Pixel[] = [];

    function spawn(fromTop = true): Pixel {
      const sz  = SIZES[Math.floor(Math.random() * SIZES.length)];
      const st  = STYLES[Math.floor(Math.random() * STYLES.length)];
      return {
        x: Math.random() * c.width,
        y: fromTop
          ? -sz - Math.random() * 150
          : Math.random() * (c.height - sz),
        vx: (Math.random() - 0.5) * 1.6,
        vy: fromTop ? 1.0 + Math.random() * 2.5 : Math.random() * 2.0,
        size: sz,
        style: st,
        alpha: 1,
        bounces: 0,
        maxBounces: 2 + Math.floor(Math.random() * 4),
        settled: false,
        settleFrames: 45 + Math.floor(Math.random() * 80),
        alive: true,
      };
    }

    for (let i = 0; i < 60; i++) pool.push(spawn(false));

    let frame = 0;
    let raf: number;

    function drawBlock(p: Pixel) {
      const sz = p.size;
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      const bw = borderW(sz);
      const { br, bg, bb, ba, fr, fg, fb, fa } = p.style;
      const a = p.alpha;

      g.fillStyle = `rgba(${fr},${fg},${fb},${fa * a})`;
      g.fillRect(px, py, sz, sz);

      g.fillStyle = `rgba(${br},${bg},${bb},${ba * a})`;
      g.fillRect(px,            py,            sz, bw);        
      g.fillRect(px,            py + sz - bw,  sz, bw);        
      g.fillRect(px,            py + bw,       bw, sz - bw*2); 
      g.fillRect(px + sz - bw,  py + bw,       bw, sz - bw*2); 
    }

    function tick() {
      raf = requestAnimationFrame(tick);
      frame++;

      if (frame % 22 === 0) {
        for (let n = 0; n < 3; n++) pool.push(spawn(true));
      }

      g.clearRect(0, 0, c.width, c.height);

      for (let i = pool.length - 1; i >= 0; i--) {
        const p = pool[i];
        if (!p.alive) { pool.splice(i, 1); continue; }

        if (!p.settled) {
          p.vy += 0.055;   
          p.vy *= 0.998;
          p.vx *= 0.994;
          p.x  += p.vx;
          p.y  += p.vy;

          const floor = c.height - p.size;

          if (p.y >= floor) {
            p.y  = floor;                                      
            p.vy *= -(0.20 + Math.random() * 0.25);          
            p.vx *= (0.55 + Math.random() * 0.25);
            p.bounces++;

            if (p.bounces >= p.maxBounces || Math.abs(p.vy) < 0.4) {
              p.y      = floor;                               
              p.settled = true;
            }
          }

          if (p.x < -40 || p.x > c.width + 40) {
            p.alive = false; continue;
          }
        } else {
          p.settleFrames--;
          if (p.settleFrames <= 0) {
            p.alpha -= 0.016;
            if (p.alpha <= 0) { p.alive = false; continue; }
          }
        }

        drawBlock(p);
      }
    }

    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ── Action Handlers ──────────────────────────────────────────────
  // (logout handler defined above using NextAuth signOut)

 

  return (
    <>
      <style>{`
        html, body {
          overflow: hidden !important;
          height: 100%;
          margin: 0; padding: 0;
          scrollbar-width: none;
          -ms-overflow-style: none;
          background-color: #010003;
        }
        html::-webkit-scrollbar, body::-webkit-scrollbar { display: none; }

        @keyframes twinkle {
          0%, 100% { opacity: 0.15; }
          50%       { opacity: 0.75; }
        }

        .ambient-glow {
          position: absolute;
          width: 55vw; height: 55vw;
          background: radial-gradient(circle, rgba(244,63,94,0.06) 0%, transparent 70%);
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          z-index: 1;
          filter: blur(140px);
          pointer-events: none;
        }
      `}</style>

      <Suspense fallback={null}>
        <SearchParamsHandler onAuthError={(code) => { setAuthErrorCode(code); setIsAuthModalOpen(true); }} />
      </Suspense>

      <div 
        ref={sceneRef}
        className="relative w-screen h-screen bg-[#010003] overflow-hidden select-none"
        style={{ fontFamily: "'Courier New', Courier, monospace" }}
      >
        {/* Falling Blocks Canvas Layer */}
        <canvas 
          ref={canvasRef} 
          className="absolute inset-0 pointer-events-none z-10"
        />

        <div className="ambient-glow" />

        {/* ── Conversional Tech Navigation Header ──────────────────── */}
        <header className="absolute top-0 left-0 w-full z-30 px-6 py-4 flex items-center justify-between border-b border-neutral-900 bg-[#010003]/60 backdrop-blur-md">
          {/* Left Side: App Action Nodes */}
          <div className="flex items-center space-x-6 text-[11px] font-mono tracking-wider">
            <div className="hidden md:flex items-center space-x-2 text-neutral-400 uppercase">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span>sys_status // operational</span>
            </div>
            
            {/* Direct Value Link */}
            <button 
              onClick={handleLaunchApp}
              className="cursor-pointer px-4 py-2 border border-rose-500/40 hover:border-rose-400 text-rose-300 bg-rose-500/5 hover:bg-rose-500/10 text-[9px] font-mono tracking-widest uppercase rounded-sm shadow-[0_0_22px_rgba(244,63,94,0.10)] transition-all duration-200"
            >
              [ launch_console // start chatting ]
            </button>
          </div>

          {/* Right Side: Dynamic Authentication State */}
          <div className="flex items-center space-x-6 text-[11px] font-mono tracking-wider">
            {isLoggedIn ? (
              <>
                <span className="hidden sm:inline text-neutral-500 lowercase">
                  ident::{userEmail}
                </span>
                <button 
                  onClick={handleLogout}
                  className="text-rose-300/80 hover:text-rose-300 uppercase font-semibold transition-colors duration-200"
                >
                  [ terminate_session ]
                </button>
              </>
            ) : (
              <button 
                onClick={handleLogin}
                className="cursor-pointer px-4 py-2 border border-rose-500/40 hover:border-rose-400 text-rose-300 bg-rose-500/5 hover:bg-rose-500/10 text-[9px] font-mono tracking-widest uppercase rounded-sm shadow-[0_0_22px_rgba(244,63,94,0.10)] transition-all duration-200"
                >
                [ initialize_auth ]
              </button>
            )}
          </div>
        </header>

        {/* Unified Absolute Central Centerpiece */}
        <main className="relative z-20 flex flex-col items-center justify-center h-full w-full max-w-2xl mx-auto px-6 text-center space-y-10">
          
          {/* Scaled Central Pixel Logo Object */}
          <div className="w-full max-w-[330px] sm:max-w-[460px] filter drop-shadow-[0_0_44px_rgba(244,63,94,0.18)] transition-all duration-300">
            <img 
              src="/images/omnimind_logo.png" 
              alt="OmniMind Logo" 
              className="w-full h-auto object-contain render-pixelated"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* Expanded & Intentional Product Descriptives */}
          <div className="space-y-4 w-full max-w-[330px] sm:max-w-[460px] pt-2">
            <p className="text-[12px] font-mono tracking-[0.3em] text-rose-300/80 uppercase">
              // high-precision rag intelligence engine
            </p>
            <p className="max-w-md mx-auto text-[11px] font-mono tracking-wide text-neutral-500 leading-relaxed uppercase">
              Stop digging through static markdown, logs, and repositories. Turn your codebase and architecture documentation into an active, contextual development partner.
            </p>
          </div>

          {/* Explicit Primary Action Layer */}
          <div className="pt-2">
            <button
              onClick={handleLaunchApp}
              className="cursor-pointer px-6 py-3 border border-rose-500/40 hover:border-rose-400 text-rose-300 bg-rose-500/5 hover:bg-rose-500/10 text-[12px] font-mono tracking-widest uppercase rounded-sm shadow-[0_0_22px_rgba(244,63,94,0.10)] transition-all duration-200"
            >
              &gt;_ query_your_docs_now
            </button>
          </div>

          {/* Core System Label */}
          <div className="text-[9px] tracking-[0.4em] text-neutral-600 uppercase pt-6 font-mono">
            b.tech cse workflow node // v2.0_live
          </div>

        </main>
      </div>


      <LoginModal
        isOpen={isAuthModalOpen}
        onClose={() => { setIsAuthModalOpen(false); setAuthErrorCode(null); }}
        initialErrorCode={authErrorCode}
      />
    </>
  );
}