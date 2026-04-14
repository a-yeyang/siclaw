import { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';

interface StreamEvent {
    timestamp: number;
    caseId: string;
    eventType: string;
    text?: string;
    toolName?: string;
    toolInput?: string;
}

interface Props {
    events: StreamEvent[];
    activeCaseId: string | null;
}

export function StreamingPanel({ events, activeCaseId }: Props) {
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [events]);

    const filtered = activeCaseId
        ? events.filter(e => e.caseId === activeCaseId)
        : events;

    if (filtered.length === 0) {
        return (
            <div className="bg-gray-900 rounded-xl p-6 text-center">
                <Terminal className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Waiting for agent output...</p>
            </div>
        );
    }

    return (
        <div className="bg-gray-900 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
                <Terminal className="w-4 h-4 text-green-400" />
                <span className="text-xs font-medium text-gray-300">Agent Live Output</span>
                <span className="text-xs text-gray-500 ml-auto">{filtered.length} events</span>
            </div>
            <div
                ref={scrollRef}
                className="p-4 max-h-96 overflow-y-auto font-mono text-xs leading-relaxed"
            >
                {filtered.map((evt, i) => (
                    <div key={i} className="mb-1">
                        {evt.eventType === 'message_update' && evt.text && (
                            <span className="text-green-400">{evt.text}</span>
                        )}
                        {evt.eventType === 'tool_execution_start' && (
                            <div className="text-cyan-400">
                                <span className="text-gray-500">{'> '}</span>
                                <span className="text-yellow-400">[{evt.toolName}]</span>{' '}
                                <span className="text-cyan-300">{evt.toolInput}</span>
                            </div>
                        )}
                        {evt.eventType === 'tool_execution_end' && (
                            <div className="text-gray-500 text-xs">--- tool done ---</div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
