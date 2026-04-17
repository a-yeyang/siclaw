import { useState } from 'react';
import { ChevronDown, ChevronRight, Clock, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RegressionRunRecord } from '@/hooks/useRegression';

interface RunRecordDetailProps {
    record: RegressionRunRecord;
    index: number;
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m${s}s`;
}

function outcomeColor(outcome: string): string {
    switch (outcome) {
        case 'PASS': return 'text-green-600 bg-green-50 border-green-200';
        case 'FAIL': return 'text-red-600 bg-red-50 border-red-200';
        case 'ERROR': return 'text-amber-600 bg-amber-50 border-amber-200';
        default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
}

function outcomeIcon(outcome: string) {
    switch (outcome) {
        case 'PASS': return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
        case 'FAIL': return <XCircle className="w-3.5 h-3.5 text-red-500" />;
        default: return <AlertCircle className="w-3.5 h-3.5 text-amber-500" />;
    }
}

export function RunRecordDetail({ record, index }: RunRecordDetailProps) {
    const [expanded, setExpanded] = useState(false);

    return (
        <div className={cn('border rounded-md', outcomeColor(record.outcome))}>
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left"
            >
                {expanded
                    ? <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                    : <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                }
                {outcomeIcon(record.outcome)}
                <span className="text-xs font-medium">Run #{index}</span>
                <span className="text-xs font-semibold">{record.outcome}</span>
                {record.scoreCommands != null && (
                    <span className="text-xs">
                        cmd:{record.scoreCommands}/5 ans:{record.scoreConclusion ?? '-'}/5
                    </span>
                )}
                <span className="ml-auto flex items-center gap-1 text-xs opacity-70">
                    <Clock className="w-3 h-3" />
                    {formatDuration(record.durationMs)}
                </span>
            </button>

            {expanded && (
                <div className="px-3 pb-3 space-y-3 text-xs border-t border-current/10">
                    {record.reason && (
                        <div className="mt-2">
                            <div className="font-medium text-gray-700 mb-1">Reason</div>
                            <div className="text-gray-600">{record.reason}</div>
                        </div>
                    )}

                    {record.scoreReasoning && (
                        <div>
                            <div className="font-medium text-gray-700 mb-1">Score Reasoning</div>
                            <div className="text-gray-600 whitespace-pre-wrap bg-white/60 rounded p-2 max-h-40 overflow-y-auto">
                                {record.scoreReasoning}
                            </div>
                        </div>
                    )}

                    {record.workOrderText && (
                        <div>
                            <div className="font-medium text-gray-700 mb-1">
                                Work Order
                                {record.workOrderDifficulty && (
                                    <span className="ml-1.5 text-gray-400">({record.workOrderDifficulty})</span>
                                )}
                            </div>
                            <div className="text-gray-600 bg-white/60 rounded p-2">{record.workOrderText}</div>
                        </div>
                    )}

                    {record.agentCommands && record.agentCommands.length > 0 && (
                        <div>
                            <div className="font-medium text-gray-700 mb-1">Agent Commands ({record.agentCommands.length})</div>
                            <div className="bg-white/60 rounded p-2 font-mono max-h-40 overflow-y-auto space-y-0.5">
                                {record.agentCommands.map((cmd, i) => (
                                    <div key={i} className="text-gray-700">{cmd}</div>
                                ))}
                            </div>
                        </div>
                    )}

                    {record.agentResponse && (
                        <div>
                            <div className="font-medium text-gray-700 mb-1">Agent Response</div>
                            <div className="text-gray-600 whitespace-pre-wrap bg-white/60 rounded p-2 max-h-60 overflow-y-auto">
                                {record.agentResponse}
                            </div>
                        </div>
                    )}

                    <div className="text-gray-400 text-[10px]">{record.createdAt}</div>
                </div>
            )}
        </div>
    );
}
