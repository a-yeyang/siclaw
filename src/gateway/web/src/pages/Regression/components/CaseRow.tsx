import { useState } from 'react';
import { Play, ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, AlertCircle, MinusCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RegressionPublicCase, RegressionRunRecord } from '@/hooks/useRegression';
import { RunRecordDetail } from './RunRecordDetail';

interface CaseRowProps {
    case_: RegressionPublicCase;
    runs: RegressionRunRecord[];
    isSelected: boolean;
    isRunning: boolean;
    onToggleSelect: () => void;
    onRun: () => void;
}

function outcomeIcon(outcome: string) {
    switch (outcome) {
        case 'PASS': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
        case 'FAIL': return <XCircle className="w-4 h-4 text-red-500" />;
        case 'ERROR': return <AlertCircle className="w-4 h-4 text-amber-500" />;
        case 'SKIP': return <MinusCircle className="w-4 h-4 text-gray-400" />;
        case 'MISSING_CONTEXT': return <AlertCircle className="w-4 h-4 text-orange-400" />;
        default: return <MinusCircle className="w-4 h-4 text-gray-300" />;
    }
}

function outcomeBadge(outcome: string) {
    const colors: Record<string, string> = {
        PASS: 'bg-green-100 text-green-700',
        FAIL: 'bg-red-100 text-red-700',
        ERROR: 'bg-amber-100 text-amber-700',
        SKIP: 'bg-gray-100 text-gray-500',
        MISSING_CONTEXT: 'bg-orange-100 text-orange-700',
    };
    return (
        <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', colors[outcome] ?? 'bg-gray-100 text-gray-500')}>
            {outcome}
        </span>
    );
}

export function CaseRow({ case_, runs, isSelected, isRunning, onToggleSelect, onRun }: CaseRowProps) {
    const [expanded, setExpanded] = useState(false);
    const latestRun = runs.length > 0 ? runs[runs.length - 1] : null;

    return (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-gray-50 transition-colors">
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={onToggleSelect}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                <button
                    onClick={() => setExpanded(!expanded)}
                    className="p-0.5 hover:bg-gray-100 rounded"
                >
                    {expanded
                        ? <ChevronDown className="w-4 h-4 text-gray-400" />
                        : <ChevronRight className="w-4 h-4 text-gray-400" />
                    }
                </button>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{case_.id}</span>
                        <span className="text-xs text-gray-500 truncate">{case_.title}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                            {case_.faultType}
                        </span>
                        <span className="text-xs text-gray-400">
                            {case_.reproducible ? 'reproducible' : 'knowledge-qa'}
                        </span>
                        {case_.tags.map(t => (
                            <span key={t} className="text-xs px-1 py-0.5 rounded bg-indigo-50 text-indigo-600">{t}</span>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {latestRun ? (
                        <div className="flex items-center gap-1.5">
                            {outcomeIcon(latestRun.outcome)}
                            {outcomeBadge(latestRun.outcome)}
                            {latestRun.scoreCommands != null && (
                                <span className="text-xs text-gray-500">
                                    cmd:{latestRun.scoreCommands} ans:{latestRun.scoreConclusion ?? '-'}
                                </span>
                            )}
                        </div>
                    ) : (
                        <span className="text-xs text-gray-400">Not run</span>
                    )}
                    {runs.length > 1 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                            x{runs.length}
                        </span>
                    )}
                    <button
                        onClick={onRun}
                        disabled={isRunning}
                        className={cn(
                            'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors',
                            isRunning
                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
                        )}
                    >
                        {isRunning
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Play className="w-3.5 h-3.5" />
                        }
                        {isRunning ? 'Running' : 'Run'}
                    </button>
                </div>
            </div>

            {expanded && (
                <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 space-y-2">
                    {runs.length === 0 ? (
                        <p className="text-xs text-gray-400">No run history yet.</p>
                    ) : (
                        [...runs].reverse().map((r, idx) => (
                            <RunRecordDetail key={r.id} record={r} index={runs.length - idx} />
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
