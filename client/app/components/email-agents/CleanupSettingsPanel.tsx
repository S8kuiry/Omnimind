"use client";

import { useEffect, useState, useRef } from "react";
import { Check, Loader2, AlertCircle } from "lucide-react";
import {
  fetchCleanupSettings,
  updateCleanupSettings,
} from "@/lib/automationApi";

export default function CleanupSettingsPanel({ userEmail }: { userEmail: string }) {
  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState(60);
  const [customInput, setCustomInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveGeneration = useRef(0);
  const pendingPatch = useRef<{ enabled?: boolean; olderThanDays?: number }>({});

  useEffect(() => {
    void (async () => {
      const settings = await fetchCleanupSettings(userEmail);
      if (settings) {
        setEnabled(settings.enabled);
        setDays(settings.olderThanDays);
      }
      setLoaded(true);
    })();
  }, [userEmail]);

  useEffect(() => {
    return () => {
      if (savedTimeout.current) clearTimeout(savedTimeout.current);
      if (persistTimeout.current) clearTimeout(persistTimeout.current);
    };
  }, []);

  // Optimistic UI + debounced persist — avoids racey rollbacks when clicking presets quickly
  const save = (next: { enabled?: boolean; olderThanDays?: number }) => {
    if (next.enabled !== undefined) {
      setEnabled(next.enabled);
      pendingPatch.current.enabled = next.enabled;
    }
    if (next.olderThanDays !== undefined) {
      setDays(next.olderThanDays);
      pendingPatch.current.olderThanDays = next.olderThanDays;
    }

    setStatus("saving");
    if (persistTimeout.current) clearTimeout(persistTimeout.current);
    if (savedTimeout.current) clearTimeout(savedTimeout.current);

    persistTimeout.current = setTimeout(() => {
      const patch = { ...pendingPatch.current };
      pendingPatch.current = {};
      const generation = ++saveGeneration.current;

      void updateCleanupSettings(userEmail, patch)
        .then((result) => {
          if (generation !== saveGeneration.current) return;
          if (!result) throw new Error("save failed");
          setEnabled(result.enabled);
          setDays(result.olderThanDays);
          setStatus("saved");
          savedTimeout.current = setTimeout(() => setStatus("idle"), 1500);
        })
        .catch(() => {
          if (generation !== saveGeneration.current) return;
          setStatus("error");
          savedTimeout.current = setTimeout(() => setStatus("idle"), 2000);
          void fetchCleanupSettings(userEmail).then((settings) => {
            if (!settings || generation !== saveGeneration.current) return;
            setEnabled(settings.enabled);
            setDays(settings.olderThanDays);
          });
        });
    }, 300);
  };

  const presets = [30, 60, 90, 180];
  const isCustomActive = !presets.includes(days);

  const chipBase: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: "8px",
    fontSize: "10px",
    border: "1px solid",
    cursor: "pointer",
    transition: "background 120ms ease, border-color 120ms ease, color 120ms ease",
  };

  const chipActive: React.CSSProperties = {
    background: "rgba(210,140,160,0.14)",
    borderColor: "rgba(210,140,160,0.4)",
    color: "rgba(210,140,160,0.95)",
  };

  const chipInactive: React.CSSProperties = {
    background: "rgba(255,255,255,0.02)",
    borderColor: "rgba(255,255,255,0.1)",
    color: "rgba(255,255,255,0.5)",
  };

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "rgba(255,255,255,0.015)",
        border: "1px solid rgba(255, 255, 255, 0.21)",
        opacity: loaded ? 1 : 0.5,
        transition: "opacity 200ms ease",
      }}
    >
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <h2 className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>
            Inbox cleanup
          </h2>
          <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.28)" }}>
            Unread mail older than {days} days is moved to Gmail Trash. Attention queue is never touched.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Status indicator */}
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider" style={{ minWidth: "52px" }}>
            {status === "saving" && (
              <>
                <Loader2 size={10} className="animate-spin" style={{ color: "rgba(210,140,160,0.7)" }} />
                <span style={{ color: "rgba(255,255,255,0.35)" }}>saving</span>
              </>
            )}
            {status === "saved" && (
              <>
                <Check size={10} style={{ color: "rgba(100,220,100,0.8)" }} />
                <span style={{ color: "rgba(100,220,100,0.7)" }}>saved</span>
              </>
            )}
            {status === "error" && (
              <>
                <AlertCircle size={10} style={{ color: "rgba(255,100,100,0.8)" }} />
                <span style={{ color: "rgba(255,100,100,0.7)" }}>failed</span>
              </>
            )}
          </div>

          {/* Toggle switch */}
          <button
            role="switch"
            aria-checked={enabled}
            onClick={() => save({ enabled: !enabled })}
            className="relative cursor-pointer flex-shrink-0"
            style={{
              width: "32px",
              height: "18px",
              borderRadius: "9px",
              background: enabled ? "rgba(100,220,100,0.25)" : "rgba(255,255,255,0.08)",
              border: `1px solid ${enabled ? "rgba(100,220,100,0.35)" : "rgba(255,255,255,0.12)"}`,
              transition: "background 150ms ease, border-color 150ms ease",
            }}
          >
            <span
              style={{
                position: "absolute",
                top: "1px",
                left: enabled ? "15px" : "1px",
                width: "14px",
                height: "14px",
                borderRadius: "50%",
                background: enabled ? "rgba(100,220,100,0.9)" : "rgba(255,255,255,0.4)",
                transition: "left 150ms ease, background 150ms ease",
              }}
            />
          </button>
          <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.45)" }}>
            {enabled ? "on" : "off"}
          </span>
        </div>
      </div>

      <div
        className="flex items-center gap-2 flex-wrap"
        style={{ opacity: enabled ? 1 : 0.4, pointerEvents: enabled ? "auto" : "none", transition: "opacity 150ms ease" }}
      >
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => save({ olderThanDays: p })}
            style={{ ...chipBase, ...(days === p ? chipActive : chipInactive) }}
          >
            {p}d
          </button>
        ))}

        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={7}
            max={365}
            placeholder="custom"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = Number(customInput);
                if (v >= 7 && v <= 365) {
                  save({ olderThanDays: v });
                  setCustomInput("");
                }
              }
            }}
            className="w-16 px-2 py-1.5 rounded-lg text-[10px] bg-transparent border outline-none"
            style={{
              borderColor: isCustomActive ? "rgba(210,140,160,0.4)" : "rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.7)",
            }}
          />
          <button
            disabled={!customInput}
            onClick={() => {
              const v = Number(customInput);
              if (v >= 7 && v <= 365) {
                save({ olderThanDays: v });
                setCustomInput("");
              }
            }}
            style={{
              ...chipBase,
              ...chipInactive,
              opacity: customInput ? 1 : 0.4,
              cursor: customInput ? "pointer" : "default",
            }}
          >
            set
          </button>
        </div>

        {isCustomActive && (
          <span style={{ ...chipBase, ...chipActive, cursor: "default" }}>
            {days}d
          </span>
        )}
      </div>
    </div>
  );
}