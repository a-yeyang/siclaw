import { useState } from 'react';
import { Play, Target, Syringe, RefreshCw, Download, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DevEvalExperiment, DevEvalCase } from '@/hooks/useDevEval';
import type { StreamEvent } from '../index';
import { CaseCard } from './CaseCard';
import { StreamingPanel } from './StreamingPanel';

interface Props {
    experiment: DevEvalExperiment;
    cases: DevEvalCase[];
    streamEvents: StreamEvent[];
    activeCaseId: string | null;
    onInject: () => void;
    onRun: () => void;
    onScore: () => void;
    onUpdateWorkOrder: (caseId: string, index: number) => void;
    onRefresh: () => void;
    onExport: () => void;
}

export function ExperimentDetail({
    experiment, cases, streamEvents, activeCaseId,
    onInject, onRun, onScore, onUpdateWorkOrder, onRefresh, onExport,
}: Props) {
    const [expandedCase, setExpandedCase] = useState<string | null>(null);

    const isGenerating = experiment.status === 'generating';
    const isInjecting = experiment.status === 'injecting';
    const isRunning = experiment.status === 'running';
    const isScoring = experiment.status === 'scoring';
    const isBusy = isGenerating || isInjecting || isRunning || isScoring;

    const injectedCount = cases.filter(c => ['injected', 'running', 'completed', 'scored'].includes(c.status)).length;
    const completedCount = cases.filter(c => c.status === 'completed' || c.status === 'scored').length;
    const scoredCount = cases.filter(c => c.status === 'scored').length;
    const errorCount = cases.filter(c => c.status === 'error').length;

    const avgCommandScore = scoredCount > 0
        ? (cases.filter(c => c.scoreCommands != null).reduce((a, c) => a + (c.scoreCommands ?? 0), 0) / scoredCount).toFixed(1)
        : '-';
    const avgConclusionScore = scoredCount > 0
        ? (cases.filter(c => c.scoreConclusion != null).reduce((a, c) => a + (c.scoreConclusion ?? 0), 0) / scoredCount).toFixed(1)
        : '-';

    // Check if any cases are still in "generated" state (not injected)
    const hasUninjected = cases.some(c => c.status === 'generated');

    return (
        <div className="p-6 max-w-5xl mx-auto">
            {/* Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
                <div className="flex items-start justify-between mb-4">
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900 mb-1">Experiment</h2>
                        <p className="text-sm text-gray-600">{experiment.prompt}</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onRefresh}
                            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                            title="Refresh"
                        >
                            <RefreshCw className={cn('w-4 h-4', isBusy && 'animate-spin')} />
                        </button>
                        <button
                            onClick={onExport}
                            className="p-2 text-gray-400 hover:text-indigo-600 rounded-lg hover:bg-gray-100"
                            title="Export"
                        >
                            <Download className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-5 gap-4 mb-4">
                    <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-gray-900">{cases.length}</p>
                        <p className="text-xs text-gray-500">Total Cases</p>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-blue-700">{injectedCount}</p>
                        <p className="text-xs text-blue-600">Injected</p>
                    </div>
                    <div className="bg-indigo-50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-indigo-700">{completedCount}</p>
                        <p className="text-xs text-indigo-600">Diagnosed</p>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-emerald-700">{avgCommandScore}</p>
                        <p className="text-xs text-emerald-600">Avg Path Score</p>
                    </div>
                    <div className="bg-purple-50 rounded-lg p-3 text-center">
                        <p className="text-2xl font-bold text-purple-700">{avgConclusionScore}</p>
                        <p className="text-xs text-purple-600">Avg Conclusion</p>
                    </div>
                </div>

                {/* Action Buttons — sequential flow: Inject → Run → Score */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={onInject}
                        disabled={isBusy || cases.length === 0}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isInjecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Syringe className="w-4 h-4" />}
                        {isInjecting ? 'Injecting...' : `1. Inject Faults`}
                    </button>
                    <button
                        onClick={onRun}
                        disabled={isBusy || injectedCount === 0}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        title={hasUninjected && injectedCount === 0 ? 'Inject faults first' : ''}
                    >
                        {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                        {isRunning ? 'Running...' : '2. Run Diagnostics'}
                    </button>
                    <button
                        onClick={onScore}
                        disabled={isBusy || completedCount === 0}
                        className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {isScoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
                        {isScoring ? 'Scoring...' : '3. Score Results'}
                    </button>

                    {errorCount > 0 && (
                        <span className="flex items-center gap-1 text-sm text-red-600">
                            <AlertCircle className="w-4 h-4" />
                            {errorCount} error(s)
                        </span>
                    )}

                    {hasUninjected && injectedCount === 0 && !isBusy && (
                        <span className="text-xs text-amber-600 ml-2">
                            Click "Inject Faults" first to create pods in the cluster
                        </span>
                    )}
                </div>
            </div>

            {/* Streaming Panel — shown during run/score */}
            {(isRunning || isScoring || streamEvents.length > 0) && (
                <div className="mb-6">
                    <StreamingPanel events={streamEvents} activeCaseId={activeCaseId} />
                </div>
            )}

            {/* Cases List */}
            {cases.length === 0 && isGenerating ? (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-3" />
                    <p className="text-gray-500">Generating fault cases...</p>
                    <p className="text-sm text-gray-400 mt-1">This may take a minute</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {cases.map(c => (
                        <CaseCard
                            key={c.id}
                            case_={c}
                            expanded={expandedCase === c.id}
                            isActive={activeCaseId === c.id}
                            onToggle={() => setExpandedCase(expandedCase === c.id ? null : c.id)}
                            onUpdateWorkOrder={(idx) => onUpdateWorkOrder(c.id, idx)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
