import { useState } from 'react';
import { X } from 'lucide-react';

interface Props {
    onGenerate: (opts: { prompt: string; namespace: string; caseCount: number }) => Promise<void>;
    onClose: () => void;
}

export function GenerateDialog({ onGenerate, onClose }: Props) {
    const [prompt, setPrompt] = useState('');
    const [namespace, setNamespace] = useState('default');
    const [caseCount, setCaseCount] = useState(3);
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!prompt.trim()) return;
        setSubmitting(true);
        try {
            await onGenerate({ prompt: prompt.trim(), namespace, caseCount });
        } catch {
            // Error handled by hook
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Generate Fault Cases</h3>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Prompt
                        </label>
                        <textarea
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            placeholder="e.g., Generate OOM and CrashLoop test cases for our nginx deployment"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                            rows={4}
                            autoFocus
                        />
                        <p className="text-xs text-gray-400 mt-1">
                            Describe what kinds of K8s fault scenarios you want to test
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Namespace
                            </label>
                            <input
                                type="text"
                                value={namespace}
                                onChange={e => setNamespace(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Number of Cases (1-20)
                            </label>
                            <input
                                type="number"
                                min={1}
                                max={20}
                                value={caseCount}
                                onChange={e => setCaseCount(Math.min(20, Math.max(1, parseInt(e.target.value) || 1)))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={!prompt.trim() || submitting}
                            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {submitting ? 'Generating...' : 'Generate'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
