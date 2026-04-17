import { Navigate } from 'react-router-dom';
import { useCapabilities } from '../hooks/useCapabilities';
import type { ReactNode } from 'react';

export function DevEvalGuard({ children }: { children: ReactNode }) {
    const { caps, loading } = useCapabilities();

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-sm">Loading...</div>
            </div>
        );
    }

    if (!caps.devEvalEnabled) {
        return <Navigate to="/pilot" replace />;
    }

    return <>{children}</>;
}
