import { useState } from 'react';
import { X, FileText, Table } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DevEvalExperiment, DevEvalCase } from '@/hooks/useDevEval';
import { exportAsCsv, exportAsMarkdown } from '../utils/export';

interface Props {
    experimentId: string;
    sendRpc: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
    onClose: () => void;
}

export function ExportDialog({ experimentId, sendRpc, onClose }: Props) {
    const [loading, setLoading] = useState(false);
    const [format, setFormat] = useState<'csv' | 'markdown'>('csv');

    const handleExport = async () => {
        setLoading(true);
        try {
            const result = await sendRpc<{ experiment: DevEvalExperiment; cases: DevEvalCase[] }>(
                'deveval.get',
                { experimentId },
            );

            let content: string;
            let filename: string;
            let mimeType: string;

            if (format === 'csv') {
                content = exportAsCsv(result.experiment, result.cases);
                filename = `deveval-${experimentId.slice(0, 8)}.csv`;
                mimeType = 'text/csv;charset=utf-8;';
            } else {
                content = exportAsMarkdown(result.experiment, result.cases);
                filename = `deveval-${experimentId.slice(0, 8)}.md`;
                mimeType = 'text/markdown;charset=utf-8;';
            }

            // Trigger download
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            onClose();
        } catch (err) {
            console.error('Export failed:', err);
            alert('Export failed: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-900">Export Results</h3>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <p className="text-sm text-gray-600">
                        Choose a format to download the experiment results.
                    </p>

                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => setFormat('csv')}
                            className={cn(
                                'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
                                format === 'csv'
                                    ? 'border-indigo-500 bg-indigo-50'
                                    : 'border-gray-200 hover:border-gray-300'
                            )}
                        >
                            <Table className={cn('w-8 h-8', format === 'csv' ? 'text-indigo-600' : 'text-gray-400')} />
                            <span className={cn('text-sm font-medium', format === 'csv' ? 'text-indigo-700' : 'text-gray-600')}>CSV</span>
                        </button>
                        <button
                            onClick={() => setFormat('markdown')}
                            className={cn(
                                'flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all',
                                format === 'markdown'
                                    ? 'border-indigo-500 bg-indigo-50'
                                    : 'border-gray-200 hover:border-gray-300'
                            )}
                        >
                            <FileText className={cn('w-8 h-8', format === 'markdown' ? 'text-indigo-600' : 'text-gray-400')} />
                            <span className={cn('text-sm font-medium', format === 'markdown' ? 'text-indigo-700' : 'text-gray-600')}>Markdown</span>
                        </button>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleExport}
                            disabled={loading}
                            className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                            {loading ? 'Exporting...' : 'Download'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
