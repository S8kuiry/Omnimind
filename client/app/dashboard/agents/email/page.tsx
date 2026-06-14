"use client";

import { useEffect, useState, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Mail, ShieldCheck, RefreshCw, XCircle,
  Inbox, CheckCircle2, AlertCircle, ArrowRight, Wifi, WifiOff,
  FileEdit, ShieldAlert, BarChart3,
} from "lucide-react";
import {
  getGmailAuthUrl,
  getAuthStatus,
  revokeGmailAuth,
  fetchEmailStats,
  fetchAgentOverview,   // CHANGE: replaces old syncEmailAgent POST
  getEmailAgentBaseUrl,
  type EmailStats,
} from "@/lib/automationApi";
import { loadMetrics, saveMetrics } from "@/lib/metricsStorage";
import EmailDashboard from "@/app/components/email-agents/EmailDashboard";

type StatCard = {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
};

interface StatsState {
  total: string;
  resolved: string;
  draftsCreated: string;
  spamBlocked: string;
  automationRate: string;
}

function EmailAgentContent() {
  const searchParams = useSearchParams();
  const { data: session, status: sessionStatus } = useSession();
  const [email, setEmail] = useState<string | null>(null);
  const [isConnected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);

  // CHANGE: seed from localStorage immediately — no flicker on return visit
  const [stats, setStats] = useState<StatsState>(() => {
    if (typeof window === 'undefined') return emptyStats()
    // We'll hydrate from localStorage after we know the email
    return emptyStats()
  });

  useEffect(() => {
    if (sessionStatus === "loading") return;

    const authStatus = searchParams.get("auth");
    const urlEmail = searchParams.get("email");
    if (authStatus === "success" && urlEmail) {
      setEmail(urlEmail);
      setConnected(true);
      setLoading(false);
      window.history.replaceState({}, "", "/dashboard/agents/email");
      // Load stats once after OAuth connect
      void loadStats(urlEmail);
      return;
    }

    void checkAuth(session?.user?.email ?? undefined);
  }, [searchParams, sessionStatus, session?.user?.email]);

  // CHANGE: Load stats once on connect — no interval polling
  // Stat bar updates live via WS metrics_updated events from EmailDashboard
  useEffect(() => {
    if (!isConnected || !email) return;

    // Seed from localStorage first for instant render
    const cached = loadMetrics(email);
    if (cached) applyStats(cached);

    // Then fetch fresh from server once
    void loadStats(email);
  }, [isConnected, email]);

  const checkAuth = async (accountEmail?: string) => {
    const statusData = await getAuthStatus(accountEmail);
    if (statusData.connected && statusData.email) {
      setEmail(statusData.email);
      setConnected(true);
    } else {
      setEmail(null);
      setConnected(false);
    }
    setLoading(false);
  };

  const applyStats = useCallback((bufferStats: EmailStats) => {
    const processed =
      bufferStats.autoRepliesTotal +
      bufferStats.systemDroppedTotal +
      bufferStats.manualAttentionTotal;
    const automationRate =
      bufferStats.automationRate ??
      (processed > 0
        ? Math.round(((bufferStats.autoRepliesTotal + bufferStats.systemDroppedTotal) / processed) * 1000) / 10
        : 0);

    setStats({
      total: String(bufferStats.activeCards),
      resolved: String(bufferStats.autoRepliesTotal),
      draftsCreated: String(bufferStats.manualAttentionTotal),
      spamBlocked: String(bufferStats.systemDroppedTotal),
      automationRate: String(automationRate),
    });
  }, []);

  const loadStats = async (userEmail: string) => {
    setStatsLoading(true);
    try {
      // CHANGE: GET /emails/stats only — no POST /agents/email/sync
      const [statsData, overview] = await Promise.all([
        fetchEmailStats(userEmail),
        fetchAgentOverview(userEmail),
      ]);

      const merged = statsData ?? overview;
      if (merged) {
        applyStats(merged);
        saveMetrics(userEmail, merged);
      }
    } finally {
      setStatsLoading(false);
    }
  };

  const handleConnect = () => {
    window.location.href = getGmailAuthUrl();
  };

  const handleRevoke = async () => {
    const acc = email ?? session?.user?.email;
    if (!acc) return;
    setRevoking(true);
    try {
      await revokeGmailAuth(acc);
      setConnected(false);
      setEmail(null);
      setStats(emptyStats());
    } finally {
      setRevoking(false);
    }
  };

  const handleStatsUpdated = useCallback((bufferStats: EmailStats) => {
    applyStats(bufferStats);
  }, [applyStats]);

  if (loading) {
    return (
      <div className="flex-1 h-screen flex items-center justify-center" style={{ background: "#010003" }}>
        <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
          <RefreshCw size={13} className="animate-spin" style={{ color: "rgba(210,140,160,0.7)" }} />
          resolving agent state...
        </div>
      </div>
    );
  }

  const card: React.CSSProperties = {
    background: "rgba(255,255,255,0.018)",
    border: "1px solid rgba(255, 255, 255, 0.21)",
    borderRadius: "14px",
    padding: "20px",
  };

  const STAT_CARDS: StatCard[] = [
    { icon: Inbox,       label: "active queue",    value: stats.total,          sub: "emails needing review" },
    { icon: FileEdit,    label: "staged drafts",   value: stats.draftsCreated,  sub: "routed to attention queue" },
    { icon: CheckCircle2,label: "auto-resolved",   value: stats.resolved,       sub: "handled without you" },
    { icon: ShieldAlert, label: "spam blocked",    value: stats.spamBlocked,    sub: "filtered by agent" },
    { icon: BarChart3,   label: "automation rate", value: `${stats.automationRate}%`, sub: "hands-off yield" },
  ];

  return (
    <div className="flex-1 min-h-screen h-auto overflow-y-auto px-7  pt-7 pb-7 font-mono mb-100"
      style={{ background: "#010003", color: "rgba(255,255,255,0.82)" }}>
      <div className="max-w-7xl mx-auto space-y-5 h-screen">

        <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em]"
          style={{ color: "rgba(255,255,255,0.22)" }}>
          <span>omnimind</span><ArrowRight size={8} /><span>agents</span>
          <ArrowRight size={8} /><span style={{ color: "rgba(210,140,160,0.7)" }}>email</span>
        </div>

        {/* Header */}
        <div className="rounded-2xl p-5"
          style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255, 255, 255, 0.21)" }}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{
                  background: isConnected ? "rgba(100,220,100,0.06)" : "rgba(210,140,160,0.07)",
                  border: `1px solid ${isConnected ? "rgba(100,220,100,0.2)" : "rgba(210,140,160,0.2)"}`,
                }}>
                <Mail size={15} style={{ color: isConnected ? "rgba(100,220,100,0.8)" : "rgba(210,140,160,0.7)" }} />
              </div>
              <div>
                <h1 className="text-sm font-medium tracking-tight" style={{ color: "rgba(255,255,255,0.88)" }}>
                  Email Agent
                </h1>
                <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.28)" }}>
                  Gmail · Groq triage · {getEmailAgentBaseUrl().replace(/^https?:\/\//, '')}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] uppercase tracking-wider"
                    style={isConnected
                      ? { background: "rgba(100,220,100,0.05)", border: "1px solid rgba(100,220,100,0.15)", color: "rgba(100,220,100,0.8)" }
                      : { background: "rgba(255,170,0,0.04)", border: "1px solid rgba(255,170,0,0.15)", color: "rgba(255,190,80,0.75)" }}>
                    {isConnected ? <Wifi size={8} /> : <WifiOff size={8} />}
                    {isConnected ? "connected" : "not connected"}
                  </div>
                  {email && <span className="text-[9px]" style={{ color: "rgba(255,255,255,0.25)" }}>{email}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!isConnected ? (
                <button onClick={handleConnect}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] tracking-wide border cursor-pointer transition-all"
                  style={{ background: "rgba(210,140,160,0.08)", borderColor: "rgba(210,140,160,0.25)", color: "rgba(210,140,160,0.9)" }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = "rgba(210,140,160,0.15)"
                    e.currentTarget.style.borderColor = "rgba(210,140,160,0.4)"
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "rgba(210,140,160,0.08)"
                    e.currentTarget.style.borderColor = "rgba(210,140,160,0.25)"
                  }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Connect Gmail
                </button>
              ) : (
                <button onClick={handleRevoke} disabled={revoking}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] tracking-wide border cursor-pointer"
                  style={{ background: "rgba(255,50,50,0.04)", borderColor: "rgba(255,50,50,0.15)", color: "rgba(255,100,100,0.75)" }}>
                  <XCircle size={10} />
                  {revoking ? "disconnecting..." : "disconnect"}
                </button>
              )}
            </div>
          </div>
        </div>

        {!isConnected && (
          <div className="rounded-xl px-5 py-4 flex items-start gap-3"
            style={{ background: "rgba(210,140,160,0.03)", border: "1px dashed rgba(210,140,160,0.15)" }}>
            <ShieldCheck size={14} className="flex-shrink-0 mt-0.5" style={{ color: "rgba(210,140,160,0.5)" }} />
            <div>
              <p className="text-[11px] font-medium mb-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>
                Gmail access required
              </p>
              <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>
                Connect Gmail to start auto-triaging your inbox. The agent runs continuously — only emails needing your attention surface here.
              </p>
            </div>
          </div>
        )}

        {/* Stat cards */}
        {isConnected && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {statsLoading && !stats.resolved && (
              <div className="col-span-full flex items-center justify-center gap-2 py-3 rounded-xl"
                style={{ background: 'rgba(210,140,160,0.04)', border: '1px solid rgba(210,140,160,0.12)' }}>
                <RefreshCw size={12} className="animate-spin" style={{ color: 'rgba(210,140,160,0.7)' }} />
                <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Loading agent metrics...
                </span>
              </div>
            )}
            {STAT_CARDS.map(({ icon: Icon, label, value, sub }) => (
              <div key={label} style={card}>
                <div className="flex items-center gap-1.5 mb-2" style={{ color: "rgba(255,255,255,0.25)" }}>
                  <Icon size={10} />
                  <span className="text-[9px] uppercase tracking-[0.15em]">{label}</span>
                </div>
                <div className="text-2xl font-light mb-0.5 tabular-nums" style={{ color: "rgba(255,255,255,0.88)" }}>
                  {value}
                </div>
                <div className="text-[10px]" style={{ color: "rgba(255,255,255,0.28)" }}>{sub}</div>
              </div>
            ))}
          </div>
        )}

        {/* Dashboard */}
        {isConnected && email && (
          <EmailDashboard
            userEmail={email}
            onStatsUpdated={handleStatsUpdated}
          />
        )}
        <div className="h-5"></div>
      </div>
    </div>
  );
}

function emptyStats(): StatsState {
  return { total: "—", resolved: "—", draftsCreated: "0", spamBlocked: "0", automationRate: "0" };
}

export default function EmailAgentDashboard() {
  return (
    <Suspense fallback={
      <div className="flex-1 h-screen flex items-center justify-center" style={{ background: "#010003" }}>
        <RefreshCw size={13} className="animate-spin" style={{ color: "rgba(210,140,160,0.6)" }} />
      </div>
    }>
      <EmailAgentContent />
    </Suspense>
  );
}