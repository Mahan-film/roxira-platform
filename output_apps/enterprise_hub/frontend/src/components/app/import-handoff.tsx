"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Import wizard tabs: single file vs whole-database package. */
export type ImportTab = "file" | "package";

/** Database packages and every non-single-file format (.sqlite/.sql/.zip/.xls/.ods/.dbf/.iif/.ofx/…) belong to the whole-database tab. */
export function isDatabaseFile(file: File): boolean {
  return /\.(sqlite3?|db|sql|zip|xls|ods|dbf|tsv|json|xml|iif|ofx|qbo|qfx|mdb|accdb|bak|mdf|dump)$/i.test(file.name);
}

interface ImportHandoffValue {
  /** A file dropped anywhere in /app, waiting for the import wizard. */
  pendingFile: File | null;
  /** Which import tab the next visit to /app/import should open. */
  pendingTab: ImportTab | null;
  setPendingFile: (file: File | null) => void;
  setPendingTab: (tab: ImportTab | null) => void;
}

const ImportHandoffContext = createContext<ImportHandoffValue | null>(null);

/**
 * In-memory (never sessionStorage) handoff between the drop-anywhere overlay /
 * command palette and the import wizard. It lives in the app shell so it
 * survives client-side navigation to /app/import.
 */
export function ImportHandoffProvider({ children }: { children: ReactNode }) {
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingTab, setPendingTab] = useState<ImportTab | null>(null);

  const value = useMemo<ImportHandoffValue>(
    () => ({ pendingFile, pendingTab, setPendingFile, setPendingTab }),
    [pendingFile, pendingTab],
  );

  return (
    <ImportHandoffContext.Provider value={value}>
      {children}
    </ImportHandoffContext.Provider>
  );
}

export function useImportHandoff(): ImportHandoffValue {
  const value = useContext(ImportHandoffContext);
  if (!value) {
    throw new Error("useImportHandoff must be used within ImportHandoffProvider");
  }
  return value;
}
