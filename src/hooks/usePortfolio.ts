// ============================================================
// v9.142.0 unified portfolio hook: positions/trades/logic/watch/todos
// Local server uses /api/portfolio; fallback to empty ledger offline.
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, isLocalServer } from "../lib/cloudStore";
import type { LogicEntry } from "../lib/logicLedger";

export interface PortfolioTradeInput {
  code: string;
  name?: string;
  action: "buy" | "sell" | "stop" | "adjust";
  price: number;
  quantity?: number;
  cost?: number | null;
  pnlPct?: number | null;
  decisionPostRef?: string | null;
  simulated?: boolean;
  notes?: string;
  date?: string;
}

export interface PortfolioLogicInput {
  id?: number | string;
  code: string;
  name?: string;
  thesis: string;
  catalysts?: LogicEntry["catalysts"];
  breakLine?: number | null;
  board?: string | null;
  status?: "验证中" | "已兑现" | "已证伪" | "已离场";
  decisionRef?: string | null;
  tradeRef?: number | null;
  simulated?: boolean;
}

export interface PortfolioState {
  positions: Array<Record<string, any>>;
  simulatedPositions: Array<Record<string, any>>;
  logic: LogicEntry[];
  watch: Array<Record<string, any>>;
  decisions: Array<Record<string, any>>;
  todos: Array<{ type: string; severity: string; message: string; code?: string | null }>;
  concentration: Record<string, any>;
  asOf: string | null;
}

const EMPTY: PortfolioState = {
  positions: [],
  simulatedPositions: [],
  logic: [],
  watch: [],
  decisions: [],
  todos: [],
  concentration: {},
  asOf: null,
};

function toLogicEntry(row: Record<string, any>): LogicEntry {
  const entry: Record<string, any> = {
    id: String(row.id),
    code: row.code,
    name: row.name || row.code,
    thesis: row.thesis,
    catalysts: Array.isArray(row.catalysts) ? row.catalysts : [],
    breakLine: row.breakLine != null ? Number(row.breakLine) : null,
    board: row.board ?? null,
    boardCode: null,
    status: row.status ?? "验证中",
    createdAt: row.createdAt ? new Date(row.createdAt).getTime() : Date.now(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : Date.now(),
    closedAt: row.closedAt ?? null,
    decisionRef: row.decisionRef ?? null,
    tradeRef: row.tradeRef ?? null,
    simulated: Boolean(row.simulated),
  };
  return entry as LogicEntry;
}

export function usePortfolio() {
  const [state, setState] = useState<PortfolioState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!isLocalServer()) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const r = await apiFetch("/api/portfolio", { signal: AbortSignal.timeout(12000) });
      if (!r.ok) throw new Error(`portfolio ${r.status}`);
      const j = await r.json();
      setState({
        positions: Array.isArray(j.positions) ? j.positions : [],
        simulatedPositions: Array.isArray(j.simulatedPositions) ? j.simulatedPositions : [],
        logic: Array.isArray(j.logic) ? j.logic.map(toLogicEntry) : [],
        watch: Array.isArray(j.watch) ? j.watch : [],
        decisions: Array.isArray(j.decisions) ? j.decisions : [],
        todos: Array.isArray(j.todos) ? j.todos : [],
        concentration: j.concentration ?? {},
        asOf: j.asOf ?? null,
      });
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);

  const addTrade = useCallback(async (input: PortfolioTradeInput) => {
    if (!isLocalServer()) return;
    const r = await apiFetch("/api/portfolio/trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error ?? `trade ${r.status}`);
    }
    const j = await r.json();
    if (j.portfolio) setState(j.portfolio);
    return j.trade;
  }, []);

  const saveLogic = useCallback(async (input: PortfolioLogicInput) => {
    if (!isLocalServer()) return;
    const r = await apiFetch("/api/portfolio/logic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error ?? `logic ${r.status}`);
    }
    const j = await r.json();
    if (j.portfolio) setState(j.portfolio);
    return j.logic;
  }, []);

  const deleteLogic = useCallback(async (id: number | string) => {
    if (!isLocalServer()) return;
    const r = await apiFetch(`/api/portfolio/logic/${Number(id)}`, { method: "DELETE" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j?.error ?? `delete ${r.status}`);
    }
    const j = await r.json();
    if (j.portfolio) setState(j.portfolio);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { ...state, loading, error, refresh, addTrade, saveLogic, deleteLogic };
}
