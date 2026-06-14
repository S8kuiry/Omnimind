"use client";

import { useEffect, useState } from "react";
import {
  fetchCleanupSettings,
  updateCleanupSettings,
} from "@/lib/automationApi";

export default function CleanupSettingsPanel({ userEmail }: { userEmail: string }) {
  const [enabled, setEnabled] = useState(true);
  const [days, setDays] = useState(60);
  const [customInput, setCustomInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const settings = await fetchCleanupSettings(userEmail);
      if (settings) {
        setEnabled(settings.enabled);
        setDays(settings.olderThanDays);
      }
    })();
  }, [userEmail]);

  const save = async (next: { enabled?: boolean; olderThanDays?: number }) => {
    setSaving(true);
    try {
      await updateCleanupSettings(userEmail, next);
      if (next.enabled !== undefined) setEnabled(next.enabled);
      if (next.olderThanDays !== undefined) setDays(next.olderThanDays);
    } finally {
      setSaving(false);
    }
  };

  const presets = [30, 60, 90, 180];

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "rgba(255,255,255,0.015)",
        border: "1px solid rgba(255, 255, 255, 0.21)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2
            className="text-[11px] font-medium"
            style={{ color: "rgba(255,255,255,0.7)" }}
          >
            Inbox cleanup
          </h2>
          <p
            className="text-[10px] mt-0.5"
            style={{ color: "rgba(255,255,255,0.28)" }}
          >
            Unread mail older than {days} days is moved to Gmail Trash. Attention
            queue is never touched.
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => void save({ enabled: e.target.checked })}
          />
          <span
            className="text-[10px]"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            {enabled ? "auto-clean on" : "auto-clean off"}
          </span>
        </label>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {presets.map((p) => (
          <button
            key={p}
            disabled={saving}
            onClick={() => void save({ olderThanDays: p })}
            className="px-3 py-1.5 rounded-lg text-[10px] border cursor-pointer"
            style={
              days === p
                ? {
                    background: "rgba(210,140,160,0.12)",
                    borderColor: "rgba(210,140,160,0.35)",
                    color: "rgba(210,140,160,0.9)",
                  }
                : {
                    background: "rgba(255,255,255,0.02)",
                    borderColor: "rgba(255,255,255,0.1)",
                    color: "rgba(255,255,255,0.5)",
                  }
            }
          >
            {p}d
          </button>
        ))}
        <input
          type="number"
          min={7}
          max={365}
          placeholder="custom"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          className="w-20 px-2 py-1.5 rounded-lg text-[10px] bg-transparent border"
          style={{
            borderColor: "rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.7)",
          }}
        />
        <button
          disabled={saving || !customInput}
          onClick={() => {
            const v = Number(customInput);
            if (v >= 7 && v <= 365) {
              void save({ olderThanDays: v });
              setCustomInput("");
            }
          }}
          className="px-3 py-1.5 rounded-lg text-[10px] border cursor-pointer"
          style={{
            background: "rgba(255,255,255,0.02)",
            borderColor: "rgba(255,255,255,0.1)",
            color: "rgba(255,255,255,0.5)",
          }}
        >
          save
        </button>
      </div>
    </div>
  );
}
