import { BookOpen, SearchCode, Cpu, Timer, Terminal, AlertTriangle, ArrowRight } from 'lucide-react';
import type { SystemStatus } from '@/hooks/usePilot';

export interface WelcomeAreaProps {
    systemStatus: SystemStatus | null;
    onSendPrompt: (text: string) => void;
    onNavigateModels: () => void;
}

const CAPABILITIES = [
    {
        icon: BookOpen,
        title: 'Skills',
        description: 'Reusable diagnostic scripts for common SRE tasks',
    },
    {
        icon: SearchCode,
        title: 'Deep Investigation',
        description: 'Hypothesis-driven root cause analysis with evidence',
    },
    {
        icon: Cpu,
        title: 'Memory',
        description: 'Remembers findings and context across sessions',
    },
    {
        icon: Timer,
        title: 'Scheduled Jobs',
        description: 'Automated health checks on a cron schedule',
    },
];

/** Prompts shown to every user on every empty session */
const SUGGESTED_PROMPTS = [
    'Check my cluster health',
    'List available skills',
    'What happened since my last session?',
];

/** Extra onboarding prompt shown only for first-time users (no PROFILE.md) */
const ONBOARDING_PROMPT = 'Introduce yourself and help me get started';

export function WelcomeArea({ systemStatus, onSendPrompt, onNavigateModels }: WelcomeAreaProps) {
    const isFirstTime = systemStatus?.hasProfile === false;
    const hasModels = systemStatus?.hasModels ?? false;
    const env = systemStatus?.env;

    const handlePromptClick = (text: string) => {
        if (!hasModels) {
            onNavigateModels();
            return;
        }
        onSendPrompt(text);
    };

    return (
        <div className="flex flex-col items-center justify-center py-12 px-4 max-w-2xl mx-auto space-y-8">

            {/* ── Onboarding block: only shown once (no PROFILE.md) ── */}
            {isFirstTime && (
                <>
                    {/* Hero */}
                    <div className="text-center space-y-2">
                        <h1 className="text-2xl font-semibold text-gray-800">Welcome to Siclaw</h1>
                        <p className="text-gray-500 text-sm">
                            Your personal SRE assistant that learns, remembers, and grows with you
                        </p>
                    </div>

                    {/* Model Setup Card */}
                    {systemStatus && !hasModels && (
                        <button
                            onClick={onNavigateModels}
                            className="w-full bg-white border-2 border-amber-300 rounded-2xl shadow-sm p-5 flex items-center justify-between hover:border-amber-400 transition-colors group"
                        >
                            <div className="flex items-center gap-3">
                                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                                <div className="text-left">
                                    <p className="text-sm font-medium text-gray-800">Configure your first AI model</p>
                                    <p className="text-xs text-gray-500 mt-0.5">Add a model provider to start chatting</p>
                                </div>
                            </div>
                            <ArrowRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
                        </button>
                    )}

                    {/* Capability Grid */}
                    <div className="w-full grid grid-cols-2 gap-3">
                        {CAPABILITIES.map((cap) => (
                            <div
                                key={cap.title}
                                className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 space-y-1.5"
                            >
                                <cap.icon className="w-5 h-5 text-gray-400" />
                                <p className="text-sm font-medium text-gray-700">{cap.title}</p>
                                <p className="text-xs text-gray-500 leading-relaxed">{cap.description}</p>
                            </div>
                        ))}
                    </div>

                    {/* Environment Card */}
                    {env && (env.kubectl || env.tools.length > 0) && (
                        <div className="w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <Terminal className="w-4 h-4 text-gray-400" />
                                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Environment</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {env.kubectlContext && (
                                    <span className="inline-flex items-center text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-1">
                                        kubectl: {env.kubectlContext}
                                    </span>
                                )}
                                {env.tools.map((tool) => (
                                    <span
                                        key={tool}
                                        className="inline-flex items-center text-xs bg-gray-50 text-gray-600 border border-gray-200 rounded-full px-2.5 py-1"
                                    >
                                        {tool}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* ── Suggested Prompts: shown on every empty session ── */}
            {systemStatus && (
                <div className="w-full space-y-3">
                    <p className="text-xs text-center text-gray-400">Try asking</p>
                    <div className="flex flex-wrap gap-2 justify-center">
                        {/* Onboarding CTA — only for first-time users */}
                        {isFirstTime && (
                            <button
                                onClick={() => handlePromptClick(ONBOARDING_PROMPT)}
                                className="rounded-full px-4 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-sm text-blue-700 transition-colors"
                            >
                                {ONBOARDING_PROMPT}
                            </button>
                        )}
                        {SUGGESTED_PROMPTS.map((prompt) => (
                            <button
                                key={prompt}
                                onClick={() => handlePromptClick(prompt)}
                                className="rounded-full px-4 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-sm text-gray-700 transition-colors"
                            >
                                {prompt}
                            </button>
                        ))}
                    </div>
                    {!hasModels && (
                        <p className="text-xs text-center text-amber-600">
                            Configure a model first to start chatting
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
