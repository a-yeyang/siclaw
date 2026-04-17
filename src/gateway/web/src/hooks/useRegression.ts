import { useState, useCallback } from 'react';

export interface RegressionPublicCase {
    id: string;
    title: string;
    faultType: string;
    reproducible: boolean;
    namespace: string;
    tags: string[];
    workOrders: Array<{ difficulty: string; text: string }>;
}

export interface RegressionRunRecord {
    id: string;
    caseId: string;
    runIndex: number;
    outcome: string;
    reason?: string;
    scoreCommands?: number;
    scoreConclusion?: number;
    scoreReasoning?: string;
    agentResponse?: string;
    agentCommands?: string[];
    workOrderText?: string;
    workOrderDifficulty?: string;
    passThreshold: { commands: number; conclusion: number };
    durationMs: number;
    createdAt: string;
}

export interface RegressionSessionSummary {
    id: string;
    fileName: string;
    caseCount: number;
    warningCount: number;
    createdAt: string;
}

export interface ParseWarning {
    caseId: string;
    message: string;
}

export function useRegression(
    sendRpc: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>,
) {
    const [sessions, setSessions] = useState<RegressionSessionSummary[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [cases, setCases] = useState<RegressionPublicCase[]>([]);
    const [warnings, setWarnings] = useState<ParseWarning[]>([]);
    const [runHistory, setRunHistory] = useState<Map<string, RegressionRunRecord[]>>(new Map());
    const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
    const [runningCaseIds, setRunningCaseIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadSessions = useCallback(async () => {
        setError(null);
        setLoading(true);
        try {
            const result = await sendRpc<{ sessions: RegressionSessionSummary[] }>('regress.listSessions');
            setSessions(result.sessions ?? []);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [sendRpc]);

    const loadSession = useCallback(async (sessionId: string) => {
        setError(null);
        setLoading(true);
        try {
            const result = await sendRpc<{
                sessionId: string;
                cases: RegressionPublicCase[];
                warnings: ParseWarning[];
            }>('regress.getSession', { sessionId });
            setCurrentSessionId(result.sessionId);
            setCases(result.cases ?? []);
            setWarnings(result.warnings ?? []);
            setSelectedCaseIds(new Set(result.cases?.map(c => c.id) ?? []));

            const histResult = await sendRpc<{
                runs: RegressionRunRecord[];
            }>('regress.getHistory', { sessionId });
            const histMap = new Map<string, RegressionRunRecord[]>();
            for (const r of histResult.runs ?? []) {
                const arr = histMap.get(r.caseId) ?? [];
                arr.push(r);
                histMap.set(r.caseId, arr);
            }
            setRunHistory(histMap);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [sendRpc]);

    const parse = useCallback(async (markdown: string, fileName: string, workspaceId?: string) => {
        setError(null);
        setLoading(true);
        try {
            const result = await sendRpc<{
                sessionId: string;
                cases: RegressionPublicCase[];
                warnings: ParseWarning[];
            }>('regress.parse', { markdown, fileName, workspaceId });
            setCurrentSessionId(result.sessionId);
            setCases(result.cases ?? []);
            setWarnings(result.warnings ?? []);
            setSelectedCaseIds(new Set(result.cases?.map(c => c.id) ?? []));
            setRunHistory(new Map());
            await loadSessions();
            return result.sessionId;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [sendRpc, loadSessions]);

    const runCase = useCallback(async (sessionId: string, caseId: string) => {
        setError(null);
        setRunningCaseIds(prev => new Set(prev).add(caseId));
        try {
            await sendRpc('regress.runCase', { sessionId, caseId });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setRunningCaseIds(prev => {
                const next = new Set(prev);
                next.delete(caseId);
                return next;
            });
        }
    }, [sendRpc]);

    const runBatch = useCallback(async (sessionId: string, caseIds: string[]) => {
        setError(null);
        setRunningCaseIds(new Set(caseIds));
        try {
            await sendRpc('regress.runBatch', { sessionId, caseIds });
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            setRunningCaseIds(new Set());
        }
    }, [sendRpc]);

    const generateReport = useCallback(async (sessionId: string, runRecordIds?: string[]) => {
        setError(null);
        try {
            const result = await sendRpc<{ report: string; fileName: string }>(
                'regress.generateReport',
                { sessionId, runRecordIds },
            );
            const blob = new Blob([result.report], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = result.fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [sendRpc]);

    const deleteSession = useCallback(async (sessionId: string) => {
        setError(null);
        try {
            await sendRpc('regress.deleteSession', { sessionId });
            setSessions(prev => prev.filter(s => s.id !== sessionId));
            if (currentSessionId === sessionId) {
                setCurrentSessionId(null);
                setCases([]);
                setWarnings([]);
                setRunHistory(new Map());
                setSelectedCaseIds(new Set());
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [sendRpc, currentSessionId]);

    const toggleCase = useCallback((caseId: string) => {
        setSelectedCaseIds(prev => {
            const next = new Set(prev);
            if (next.has(caseId)) next.delete(caseId);
            else next.add(caseId);
            return next;
        });
    }, []);

    const selectAll = useCallback(() => {
        setSelectedCaseIds(new Set(cases.map(c => c.id)));
    }, [cases]);

    const deselectAll = useCallback(() => {
        setSelectedCaseIds(new Set());
    }, []);

    const handleWsEvent = useCallback((payload: Record<string, unknown>) => {
        const type = payload.type as string;
        const eventSessionId = payload.sessionId as string;
        if (eventSessionId !== currentSessionId) return;

        if (type === 'regress_case_done') {
            const record: RegressionRunRecord = {
                id: payload.runRecordId as string,
                caseId: payload.caseId as string,
                runIndex: 0,
                outcome: payload.outcome as string,
                scoreCommands: payload.scoreCommands as number | undefined,
                scoreConclusion: payload.scoreConclusion as number | undefined,
                durationMs: payload.durationMs as number,
                passThreshold: { commands: 4, conclusion: 4 },
                createdAt: new Date().toISOString(),
            };
            setRunHistory(prev => {
                const next = new Map(prev);
                const arr = [...(next.get(record.caseId) ?? []), record];
                next.set(record.caseId, arr);
                return next;
            });
            setRunningCaseIds(prev => {
                const next = new Set(prev);
                next.delete(payload.caseId as string);
                return next;
            });
        } else if (type === 'regress_case_error') {
            setRunningCaseIds(prev => {
                const next = new Set(prev);
                next.delete(payload.caseId as string);
                return next;
            });
        } else if (type === 'regress_batch_done' || type === 'regress_batch_error') {
            setRunningCaseIds(new Set());
        }
    }, [currentSessionId]);

    return {
        sessions,
        currentSessionId,
        cases,
        warnings,
        runHistory,
        selectedCaseIds,
        runningCaseIds,
        loading,
        error,
        loadSessions,
        loadSession,
        parse,
        runCase,
        runBatch,
        generateReport,
        deleteSession,
        toggleCase,
        selectAll,
        deselectAll,
        handleWsEvent,
    };
}
