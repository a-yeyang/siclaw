import { useState, useEffect, useRef, useCallback } from 'react';
import { TestTubes, Trash2, Download, RefreshCw, Play, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useRegression, type RegressionSessionSummary } from '@/hooks/useRegression';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { UploadZone } from './components/UploadZone';
import { CaseRow } from './components/CaseRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';

export function RegressionPage() {
    const { sendRpc, isConnected } = useWebSocket();
    const regression = useRegression(sendRpc);
    const { currentWorkspace } = useWorkspace();
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    const hasLoadedRef = useRef(false);
    useEffect(() => {
        if (!isConnected) { hasLoadedRef.current = false; return; }
        if (hasLoadedRef.current) return;
        hasLoadedRef.current = true;
        regression.loadSessions();
    }, [isConnected, regression.loadSessions]);

    useWebSocket({
        onMessage: useCallback((msg: { event?: string; payload?: Record<string, unknown> }) => {
            if (msg.event !== 'deveval_event') return;
            const payload = msg.payload;
            if (!payload) return;
            regression.handleWsEvent(payload);
        }, [regression.handleWsEvent]),
    });

    const handleUpload = useCallback(async (markdown: string, fileName: string) => {
        await regression.parse(markdown, fileName, currentWorkspace?.id);
    }, [regression.parse, currentWorkspace]);

    const handleRunSelected = useCallback(() => {
        if (!regression.currentSessionId) return;
        const ids = [...regression.selectedCaseIds];
        if (ids.length === 0) return;
        regression.runBatch(regression.currentSessionId, ids);
    }, [regression]);

    const handleRunCase = useCallback((caseId: string) => {
        if (!regression.currentSessionId) return;
        regression.runCase(regression.currentSessionId, caseId);
    }, [regression]);

    const handleDownloadReport = useCallback(() => {
        if (!regression.currentSessionId) return;
        regression.generateReport(regression.currentSessionId);
    }, [regression]);

    const allSelected = regression.cases.length > 0 && regression.selectedCaseIds.size === regression.cases.length;
    const someSelected = regression.selectedCaseIds.size > 0;
    const anyRunning = regression.runningCaseIds.size > 0;
    const hasRuns = [...regression.runHistory.values()].some(r => r.length > 0);

    const passCount = [...regression.runHistory.values()].filter(runs => {
        const last = runs[runs.length - 1];
        return last?.outcome === 'PASS';
    }).length;
    const failCount = [...regression.runHistory.values()].filter(runs => {
        const last = runs[runs.length - 1];
        return last?.outcome === 'FAIL';
    }).length;
    const errorCount = [...regression.runHistory.values()].filter(runs => {
        const last = runs[runs.length - 1];
        return last?.outcome === 'ERROR' || last?.outcome === 'MISSING_CONTEXT';
    }).length;

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* Left sidebar: Sessions */}
            <div className="w-72 border-r border-gray-200 flex flex-col bg-white shrink-0">
                <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-gray-900 font-semibold text-sm">
                        <TestTubes className="w-4.5 h-4.5 text-indigo-600" />
                        Regression
                    </div>
                    <button
                        onClick={() => regression.loadSessions()}
                        className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {regression.sessions.length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-4">No sessions yet</p>
                    )}
                    {regression.sessions.map(s => (
                        <SessionItem
                            key={s.id}
                            session={s}
                            isActive={regression.currentSessionId === s.id}
                            onClick={() => regression.loadSession(s.id)}
                            onDelete={() => setDeleteTarget(s.id)}
                        />
                    ))}
                </div>
            </div>

            {/* Main content */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Upload zone */}
                <div className="p-4 border-b border-gray-200 bg-white">
                    <UploadZone onParsed={handleUpload} loading={regression.loading} />
                </div>

                {regression.cases.length > 0 ? (
                    <>
                        {/* Control bar */}
                        <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center gap-3">
                            <button
                                onClick={allSelected ? regression.deselectAll : regression.selectAll}
                                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900"
                            >
                                {allSelected
                                    ? <CheckSquare className="w-4 h-4 text-indigo-600" />
                                    : <Square className="w-4 h-4" />
                                }
                                {allSelected ? 'Deselect All' : 'Select All'}
                            </button>

                            <span className="text-xs text-gray-400">
                                {regression.selectedCaseIds.size}/{regression.cases.length} selected
                            </span>

                            <div className="flex-1" />

                            {hasRuns && (
                                <div className="flex items-center gap-2 text-xs">
                                    {passCount > 0 && <span className="text-green-600 font-medium">PASS: {passCount}</span>}
                                    {failCount > 0 && <span className="text-red-600 font-medium">FAIL: {failCount}</span>}
                                    {errorCount > 0 && <span className="text-amber-600 font-medium">ERROR: {errorCount}</span>}
                                </div>
                            )}

                            <button
                                onClick={handleRunSelected}
                                disabled={!someSelected || anyRunning}
                                className={cn(
                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                                    someSelected && !anyRunning
                                        ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                        : 'bg-gray-100 text-gray-400 cursor-not-allowed',
                                )}
                            >
                                <Play className="w-3.5 h-3.5" />
                                Run Selected ({regression.selectedCaseIds.size})
                            </button>

                            <button
                                onClick={handleDownloadReport}
                                disabled={!hasRuns}
                                className={cn(
                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                                    hasRuns
                                        ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                        : 'bg-gray-50 text-gray-300 cursor-not-allowed',
                                )}
                            >
                                <Download className="w-3.5 h-3.5" />
                                Report
                            </button>
                        </div>

                        {/* Warnings */}
                        {regression.warnings.length > 0 && (
                            <div className="px-4 py-2 bg-amber-50 border-b border-amber-200">
                                {regression.warnings.map((w, i) => (
                                    <div key={i} className="flex items-start gap-2 text-xs text-amber-700">
                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                        <span><strong>{w.caseId}</strong>: {w.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Case list */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {regression.cases.map(c => (
                                <CaseRow
                                    key={c.id}
                                    case_={c}
                                    runs={regression.runHistory.get(c.id) ?? []}
                                    isSelected={regression.selectedCaseIds.has(c.id)}
                                    isRunning={regression.runningCaseIds.has(c.id)}
                                    onToggleSelect={() => regression.toggleCase(c.id)}
                                    onRun={() => handleRunCase(c.id)}
                                />
                            ))}
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex items-center justify-center text-gray-400">
                        <div className="text-center">
                            <TestTubes className="w-12 h-12 mx-auto mb-3 opacity-30" />
                            <p className="text-sm">Upload a markdown case file to get started</p>
                            <p className="text-xs mt-1">Or select a session from the left panel</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Error display */}
            {regression.error && (
                <div className="absolute bottom-4 right-4 bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700 max-w-md shadow-lg">
                    {regression.error}
                </div>
            )}

            {/* Delete confirmation */}
            <ConfirmDialog
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                title="Delete Session"
                description="This will permanently delete this regression session and all its run history."
                variant="danger"
                confirmText="Delete"
                onConfirm={() => {
                    if (deleteTarget) regression.deleteSession(deleteTarget);
                    setDeleteTarget(null);
                }}
            />
        </div>
    );
}

function SessionItem({
    session,
    isActive,
    onClick,
    onDelete,
}: {
    session: RegressionSessionSummary;
    isActive: boolean;
    onClick: () => void;
    onDelete: () => void;
}) {
    return (
        <div
            onClick={onClick}
            className={cn(
                'flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer text-sm transition-colors group',
                isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-50',
            )}
        >
            <div className="flex-1 min-w-0">
                <div className="font-medium truncate text-xs">{session.fileName}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                    {session.caseCount} cases
                    {session.warningCount > 0 && ` / ${session.warningCount} warnings`}
                </div>
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); onDelete(); }}
                className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-400 hover:text-red-500 transition-all"
            >
                <Trash2 className="w-3.5 h-3.5" />
            </button>
        </div>
    );
}
