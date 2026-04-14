import { useState, useEffect, useRef, useCallback } from 'react';
import { FlaskConical, Plus, Trash2, Download, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useDevEval, type DevEvalExperiment } from '@/hooks/useDevEval';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ExperimentDetail } from './components/ExperimentDetail';
import { GenerateDialog } from './components/GenerateDialog';
import { ExportDialog } from './components/ExportDialog';

export interface StreamEvent {
    timestamp: number;
    caseId: string;
    eventType: string;
    text?: string;
    toolName?: string;
    toolInput?: string;
}

export function DevEvalPage() {
    const { sendRpc, isConnected } = useWebSocket();
    const devEval = useDevEval(sendRpc);
    const { currentWorkspace } = useWorkspace();

    const [showGenerate, setShowGenerate] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [exportTarget, setExportTarget] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
    const [activeCaseId, setActiveCaseId] = useState<string | null>(null);

    const hasLoadedRef = useRef(false);
    useEffect(() => {
        if (!isConnected) { hasLoadedRef.current = false; return; }
        if (hasLoadedRef.current) return;
        hasLoadedRef.current = true;
        devEval.loadExperiments();
    }, [isConnected, devEval.loadExperiments]);

    // Listen for deveval events — handle both status updates and streaming
    useWebSocket({
        onMessage: useCallback((msg: { event?: string; payload?: Record<string, unknown> }) => {
            if (msg.event !== 'deveval_event') return;
            const payload = msg.payload;
            if (!payload) return;
            const type = payload.type as string;

            // Status events — refresh data
            if (['generated', 'injected', 'run_completed', 'scoring_completed'].includes(type)) {
                devEval.loadExperiments();
                if (selectedId) devEval.loadExperiment(selectedId);
            }
            if (['case_injected', 'case_completed', 'case_scored', 'case_error'].includes(type) && selectedId) {
                devEval.loadExperiment(selectedId);
            }
            if (type === 'case_running') {
                setActiveCaseId(payload.caseId as string);
                if (selectedId) devEval.loadExperiment(selectedId);
            }

            // Streaming events — collect for live display
            if (type === 'agent_stream') {
                const evt = payload.event as Record<string, unknown> | undefined;
                const eventType = payload.eventType as string;
                const caseId = payload.caseId as string;

                if (evt && eventType && caseId) {
                    const streamEvt: StreamEvent = {
                        timestamp: Date.now(),
                        caseId,
                        eventType,
                    };

                    if (eventType === 'message_update') {
                        const ame = evt.assistantMessageEvent as { type?: string; delta?: string } | undefined;
                        if (ame?.type === 'text_delta' && ame.delta) {
                            streamEvt.text = ame.delta;
                        }
                    } else if (eventType === 'tool_execution_start') {
                        streamEvt.toolName = evt.toolName as string;
                        streamEvt.toolInput = evt.input as string;
                    }

                    // Only add if there's meaningful content
                    if (streamEvt.text || streamEvt.toolName || eventType === 'tool_execution_end') {
                        setStreamEvents(prev => [...prev.slice(-500), streamEvt]); // Keep last 500
                    }
                }
            }
        }, [selectedId, devEval.loadExperiments, devEval.loadExperiment]),
    });

    const handleGenerate = async (opts: { prompt: string; namespace: string; caseCount: number }) => {
        const id = await devEval.generate({
            ...opts,
            workspaceId: currentWorkspace?.id,
        });
        setShowGenerate(false);
        devEval.loadExperiments();
        if (id) setSelectedId(id);
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        await devEval.deleteExperiment(deleteTarget);
        if (selectedId === deleteTarget) setSelectedId(null);
        setDeleteTarget(null);
    };

    const handleSelect = (exp: DevEvalExperiment) => {
        setSelectedId(exp.id);
        setStreamEvents([]); // Clear stream on experiment switch
        setActiveCaseId(null);
        devEval.loadExperiment(exp.id);
    };

    const handleRun = async () => {
        if (!selectedId) return;
        setStreamEvents([]); // Clear previous stream
        await devEval.run(selectedId);
    };

    const statusColor = (s: string) => {
        switch (s) {
            case 'draft': return 'bg-gray-100 text-gray-600';
            case 'generating': return 'bg-blue-100 text-blue-700';
            case 'injecting': return 'bg-amber-100 text-amber-700';
            case 'running': return 'bg-indigo-100 text-indigo-700';
            case 'scoring': return 'bg-purple-100 text-purple-700';
            case 'completed': return 'bg-green-100 text-green-700';
            default: return 'bg-gray-100 text-gray-600';
        }
    };

    return (
        <div className="flex-1 flex h-full overflow-hidden">
            {/* Sidebar — Experiment List */}
            <div className="w-80 border-r border-gray-200 flex flex-col bg-white shrink-0">
                <div className="p-4 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <FlaskConical className="w-5 h-5 text-indigo-600" />
                            <h2 className="text-lg font-semibold text-gray-900">DevEval</h2>
                        </div>
                        <button
                            onClick={() => setShowGenerate(true)}
                            className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                            title="New Experiment"
                        >
                            <Plus className="w-4 h-4" />
                        </button>
                    </div>
                    <p className="text-xs text-gray-500">
                        Developer self-evaluation: generate K8s fault cases, run agent diagnostics, and score results.
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {devEval.loading && devEval.experiments.length === 0 ? (
                        <div className="p-4 text-sm text-gray-400 text-center">Loading...</div>
                    ) : devEval.experiments.length === 0 ? (
                        <div className="p-6 text-center">
                            <FlaskConical className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                            <p className="text-sm text-gray-500 mb-1">No experiments yet</p>
                            <p className="text-xs text-gray-400">Click + to create your first evaluation</p>
                        </div>
                    ) : (
                        <div className="p-2 space-y-1">
                            {devEval.experiments.map(exp => (
                                <div
                                    key={exp.id}
                                    onClick={() => handleSelect(exp)}
                                    className={cn(
                                        'p-3 rounded-lg cursor-pointer transition-colors group',
                                        selectedId === exp.id
                                            ? 'bg-indigo-50 border border-indigo-200'
                                            : 'hover:bg-gray-50 border border-transparent'
                                    )}
                                >
                                    <div className="flex items-start justify-between">
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-gray-900 truncate">
                                                {exp.prompt.length > 40 ? exp.prompt.slice(0, 40) + '...' : exp.prompt}
                                            </p>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', statusColor(exp.status))}>
                                                    {exp.status}
                                                </span>
                                                <span className="text-xs text-gray-400">{exp.caseCount} cases</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={e => { e.stopPropagation(); setExportTarget(exp.id); }}
                                                className="p-1 text-gray-400 hover:text-indigo-600"
                                                title="Export"
                                            >
                                                <Download className="w-3.5 h-3.5" />
                                            </button>
                                            <button
                                                onClick={e => { e.stopPropagation(); setDeleteTarget(exp.id); }}
                                                className="p-1 text-gray-400 hover:text-red-600"
                                                title="Delete"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1">
                                        {new Date(exp.createdAt).toLocaleString()}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-3 border-t border-gray-200">
                    <button
                        onClick={() => devEval.loadExperiments()}
                        className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Main Content — Experiment Detail */}
            <div className="flex-1 overflow-y-auto bg-gray-50">
                {selectedId && devEval.currentExperiment ? (
                    <ExperimentDetail
                        experiment={devEval.currentExperiment}
                        cases={devEval.cases}
                        streamEvents={streamEvents}
                        activeCaseId={activeCaseId}
                        onInject={() => devEval.inject(selectedId)}
                        onRun={handleRun}
                        onScore={() => devEval.score(selectedId)}
                        onUpdateWorkOrder={devEval.updateWorkOrder}
                        onRefresh={() => devEval.loadExperiment(selectedId)}
                        onExport={() => setExportTarget(selectedId)}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center h-full">
                        <div className="text-center">
                            <FlaskConical className="w-16 h-16 text-gray-200 mx-auto mb-4" />
                            <p className="text-gray-500 mb-1">Select an experiment or create a new one</p>
                            <p className="text-sm text-gray-400">Use the + button to generate fault injection test cases</p>
                        </div>
                    </div>
                )}
            </div>

            {/* Dialogs */}
            {showGenerate && (
                <GenerateDialog
                    onGenerate={handleGenerate}
                    onClose={() => setShowGenerate(false)}
                />
            )}

            {exportTarget && (
                <ExportDialog
                    experimentId={exportTarget}
                    sendRpc={sendRpc}
                    onClose={() => setExportTarget(null)}
                />
            )}

            <ConfirmDialog
                isOpen={!!deleteTarget}
                title="Delete Experiment"
                description="This will permanently delete the experiment and all its cases, scores, and results. This action cannot be undone."
                confirmText="Delete"
                variant="danger"
                onConfirm={handleDelete}
                onClose={() => setDeleteTarget(null)}
            />
        </div>
    );
}
