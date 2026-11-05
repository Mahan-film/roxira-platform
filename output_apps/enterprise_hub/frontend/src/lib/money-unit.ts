"use client";

/**
 * The money display unit (ریال / تومان / میلیون ریال) the viewer chose, remembered per organisation in
 * this browser. Amounts stay in rials everywhere; only `formatAmount` converts them for display.
 * A tenant-wide default needs a stored setting on the tenant (follow-up of #307).
 */
import { useCallback, useSyncExternalStore } from "react";

import { readRawSession, type StoredSessionBase } from "@/lib/api/session-store";
import type { MoneyUnit } from "@/lib/fa-format";

const KEY_PREFIX = "roxira.moneyUnit.";
const CHANGE_EVENT = "roxira:money-unit";
const UNITS: readonly MoneyUnit[] = ["rial", "toman", "million"];

/** Tenant id from the stored access token (unverified decode; only used as a storage key). */
function currentTenantKey(): string {
  const token = readRawSession<StoredSessionBase>()?.accessToken;
  try {
    const payload = token?.split(".")[1];
    if (payload) {
      const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
      const json = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
      if (typeof json?.tenantId === "string") return json.tenantId;
    }
  } catch {
    // fall through to the shared key
  }
  return "default";
}

export function readMoneyUnit(): MoneyUnit {
  if (typeof window === "undefined") return "rial";
  try {
    const stored = window.localStorage.getItem(KEY_PREFIX + currentTenantKey());
    return UNITS.includes(stored as MoneyUnit) ? (stored as MoneyUnit) : "rial";
  } catch {
    return "rial";
  }
}

export function writeMoneyUnit(unit: MoneyUnit): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + currentTenantKey(), unit);
  } catch {
    // private mode: the choice lasts for this page only
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The current unit and a setter; every component using it re-renders when it changes. */
export function useMoneyUnit(): [MoneyUnit, (unit: MoneyUnit) => void] {
  const unit = useSyncExternalStore(subscribe, readMoneyUnit, () => "rial" as MoneyUnit);
  const setUnit = useCallback((next: MoneyUnit) => writeMoneyUnit(next), []);
  return [unit, setUnit];
}
