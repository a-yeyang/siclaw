import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Clock, Loader2, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DevEvalCase } from '@/hooks/useDevEval';

interface Props {
    case_: DevEvalCase;
    expanded: boolean;
    isActive?: boolean;
    onToggle: () => void;
    onUpdateWorkOrder: (index: number) => void;
}

const STATUS_CONFIG: Record<string, { icon: typeof Clock; color: string; label: string }> = {
    generated: { icon: Clock, color: 'text-gray-400', label: 'Generated' },
    injected: { icon: CheckCircle2, color: 'text-amber-500', label: 'Injected' },
    running: { icon: Loader2, color: 'text-indigo-500', label: 'Running' },
    completed: { icon: CheckCircle2, color: 'text-blue-500', label: 'Diagnosed' },
    scored: { icon: Star, color: 'text-emerald-500', label: 'Scored' },
    error: { icon: AlertCircle, color: 'text-red-500', label: 'Error' },
};

function ScoreBadge({ score, label }: { score: number | null; label: string }) {
    if (score == null) return null;
    const color = score >= 4 ? 'bg-emerald-100 text-emerald-700'
        : score >= 3 ? 'bg-amber-100 text-amber-700'
        : 'bg-red-100 text-red-700';
    return (
        <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', color)}>
            {label}: {score}/5
        </span>
    );
}

const DIFFICULTY_COLORS: Record<string, string> = {
    green: 'bg-green-100 text-green-700 border-green-200',
    yellow: 'bg-amber-100 text-amber-700 border-amber-200',
    red: 'bg-red-100 text-red-700 border-red-200',
};

export function CaseCard({ case_: c, expanded, isActive, onToggle, onUpdateWorkOrder }: Props) {
    const config = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.generated;
    const StatusIcon = config.icon;

    return (
        <div className={cn('bg-white rounded-xl border overflow-hidden', isActive ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-gray-200')}>
            {/* Header */}
            <button
                onClick={onToggle}
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
            >
                {expanded
                    ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
                    : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                }
                <StatusIcon className={cn('w-4 h-4 shrink-0', config.color, c.status === 'running' && 'animate-spin')} />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                            #{c.caseIndex + 1} {c.title ?? c.faultType ?? 'Untitled'}
                        </span>
                        <span className="text-xs text-gray-400">{c.podName}</span>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <ScoreBadge score={c.scoreCommands} label="Path" />
                    <ScoreBadge score={c.scoreConclusion} label="Conclusion" />
                    <span className={cn('text-xs px-2 py-0.5 rounded-full', config.color.replace('text-', 'bg-').replace('500', '50'))}>
                        {config.label}
                    </span>
                </div>
            </button>

            {/* Expanded Content */}
            {expanded && (
                <div className="border-t border-gray-100 p-4 space-y-4">
                    {/* Error */}
                    {c.errorMessage && (
                        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                            {c.errorMessage}
                        </div>
                    )}

                    {/* Injection Command */}
                    {c.kubectlInject && (
                        <Section title="Injection Command">
                            <pre className="text-xs bg-gray-900 text-green-400 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
                                {c.kubectlInject}
                            </pre>
                        </Section>
                    )}

                    {/* Diagnostic Steps */}
                    {c.diagnosticSteps && c.diagnosticSteps.length > 0 && (
                        <Section title="Expected Diagnostic Steps">
                            <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
                                {c.diagnosticSteps.map((step, i) => (
                                    <li key={i}><code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{step}</code></li>
                                ))}
                            </ol>
                        </Section>
                    )}

                    {/* Expected Answer */}
                    {c.expectedAnswer && (
                        <Section title="Expected Root Cause">
                            <p className="text-sm text-gray-600">{c.expectedAnswer}</p>
                        </Section>
                    )}

                    {/* Work Orders */}
                    {c.workOrders && c.workOrders.length > 0 && (
                        <Section title="Work Orders (sent to agent)">
                            <div className="space-y-2">
                                {c.workOrders.map((wo, i) => (
                                    <div
                                        key={i}
                                        onClick={() => onUpdateWorkOrder(i)}
                                        className={cn(
                                            'p-3 rounded-lg border text-sm cursor-pointer transition-all',
                                            i === (c.selectedWorkOrder ?? 0)
                                                ? 'ring-2 ring-indigo-500 border-indigo-300 bg-indigo-50'
                                                : 'border-gray-200 hover:border-gray-300',
                                            DIFFICULTY_COLORS[wo.difficulty] ?? ''
                                        )}
                                    >
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xs font-medium uppercase">{wo.difficulty}</span>
                                            {i === (c.selectedWorkOrder ?? 0) && (
                                                <span className="text-xs text-indigo-600 font-medium">Selected</span>
                                            )}
                                        </div>
                                        <p className="text-gray-700">{wo.text}</p>
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* Agent Response */}
                    {c.agentResponse && (
                        <Section title="Agent Response">
                            <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg whitespace-pre-wrap max-h-96 overflow-y-auto">
                                {c.agentResponse}
                            </div>
                        </Section>
                    )}

                    {/* Agent Commands */}
                    {c.agentCommands && c.agentCommands.length > 0 && (
                        <Section title="Agent Commands Executed">
                            <div className="space-y-1">
                                {c.agentCommands.map((cmd, i) => (
                                    <div key={i} className="text-xs bg-gray-900 text-gray-300 p-2 rounded font-mono overflow-x-auto">
                                        {cmd}
                                    </div>
                                ))}
                            </div>
                        </Section>
                    )}

                    {/* Score Reasoning */}
                    {c.scoreReasoning && (
                        <Section title="Score Reasoning">
                            <p className="text-sm text-gray-600">{c.scoreReasoning}</p>
                        </Section>
                    )}
                </div>
            )}
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{title}</h4>
            {children}
        </div>
    );
}
