import { useCallback, useRef } from 'react';
import { Upload, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadZoneProps {
    onParsed: (markdown: string, fileName: string) => void;
    loading: boolean;
}

export function UploadZone({ onParsed, loading }: UploadZoneProps) {
    const inputRef = useRef<HTMLInputElement>(null);

    const handleFile = useCallback((file: File) => {
        if (!file.name.endsWith('.md')) return;
        if (file.size > 2 * 1024 * 1024) return;
        const reader = new FileReader();
        reader.onload = () => {
            const text = reader.result as string;
            onParsed(text, file.name);
        };
        reader.readAsText(file);
    }, [onParsed]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
    }, []);

    return (
        <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => inputRef.current?.click()}
            className={cn(
                'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50/50',
                loading && 'opacity-50 pointer-events-none',
            )}
        >
            <input
                ref={inputRef}
                type="file"
                accept=".md"
                className="hidden"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                    e.target.value = '';
                }}
            />
            <div className="flex flex-col items-center gap-2">
                {loading ? (
                    <FileText className="w-8 h-8 text-indigo-400 animate-pulse" />
                ) : (
                    <Upload className="w-8 h-8 text-gray-400" />
                )}
                <p className="text-sm text-gray-600">
                    {loading ? 'Parsing...' : 'Drop a markdown case file here or click to upload'}
                </p>
                <p className="text-xs text-gray-400">.md files only, max 2MB</p>
            </div>
        </div>
    );
}
