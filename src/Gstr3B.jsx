import React, { useEffect, useRef, useState } from "react";
import Gstr3BPaymentPage from "./components/Gstr3BPaymentPage.jsx";
import {
  createWorkspace,
  loadWorkspace,
  saveWorkspace,
  updatePartA,
} from "./gst/practiceStore.js";

/** Part B entry point. Mount with key={`${gstin}:${period}`} when changing return. */
export default function Gstr3B({
  gstin,
  period,
  partA,
  opening,
  onFiled,
  embedded = false,
  onNavigate,
  onWorkspaceChange,
  onDirtyChange,
  initialTab = "payment",
}) {
  const [error, setError] = useState("");
  const source = JSON.stringify(partA);
  const [workspace, setWorkspace] = useState(() => {
    try {
      const saved = loadWorkspace({ gstin, period });
      if (saved) {
        if (
          saved.status === "draft" &&
          saved.sourceFingerprint &&
          saved.sourceFingerprint !== source
        ) {
          const synced = updatePartA(saved, partA);
          synced.sourceFingerprint = source;
          saveWorkspace(synced);
          return synced;
        }
        return saved;
      }
      const fresh = createWorkspace({ gstin, period, partA, opening });
      fresh.sourceFingerprint = source;
      saveWorkspace(fresh);
      return fresh;
    } catch (e) {
      return { loadError: e.message };
    }
  });
  const appliedSource = useRef(source),
    notifiedReceipt = useRef(null);
  const commit = (next) => {
    try {
      saveWorkspace(next);
      setWorkspace(next);
      setError("");
      return true;
    } catch (e) {
      setError(e.message + " The action has not been applied.");
      return false;
    }
  };
  useEffect(() => {
    if (!workspace.loadError) onWorkspaceChange?.(workspace);
  }, [workspace, onWorkspaceChange]);
  useEffect(() => {
    if (source === appliedSource.current || workspace.loadError) return;
    if (workspace.status !== "draft") {
      setError(
        "Part A changed after payment was posted. The locked payment return has been retained.",
      );
      return;
    }
    try {
      const synced = updatePartA(workspace, JSON.parse(source));
      synced.sourceFingerprint = source;
      if (commit(synced)) appliedSource.current = source;
    } catch (e) {
      setError(e.message);
    }
  }, [source]);
  useEffect(() => {
    if (
      workspace.status === "filed" &&
      workspace.receipt?.reference !== notifiedReceipt.current &&
      onFiled
    ) {
      notifiedReceipt.current = workspace.receipt.reference;
      onFiled(workspace.receipt, workspace.balances);
    }
  }, [workspace.status, workspace.receipt?.reference, onFiled]);
  if (workspace.loadError)
    return (
      <main className="recovery">
        <h1>Practice data could not be loaded</h1>
        <p role="alert">{workspace.loadError}</p>
        <p>
          Your saved data has been retained. Restore browser storage access, or
          use a new browser profile to start a separate practice workspace.
        </p>
        <button onClick={() => location.reload()}>Try again</button>
      </main>
    );
  return (
    <Gstr3BPaymentPage
      workspace={workspace}
      onChange={commit}
      embedded={embedded}
      onNavigate={onNavigate}
      onDirtyChange={onDirtyChange}
      initialTab={initialTab}
      storageError={
        error ||
        (workspace.status !== "draft" &&
        workspace.sourceFingerprint &&
        workspace.sourceFingerprint !== source
          ? "Part A differs from the posted return. The locked payment snapshot has been retained."
          : "")
      }
    />
  );
}
