import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from './useWebSocket';

export interface Capabilities {
    isK8sMode: boolean;
    skillSpaceEnabled: boolean;
    devEvalEnabled: boolean;
    regressEnabled: boolean;
}

const DEFAULT_CAPS: Capabilities = {
    isK8sMode: false,
    skillSpaceEnabled: false,
    devEvalEnabled: false,
    regressEnabled: false,
};

let cachedCaps: Capabilities | null = null;

export function useCapabilities(): { caps: Capabilities; loading: boolean } {
    const { sendRpc, isConnected } = useWebSocket();
    const [caps, setCaps] = useState<Capabilities>(cachedCaps ?? DEFAULT_CAPS);
    const [loading, setLoading] = useState(!cachedCaps);
    const fetchedRef = useRef(false);

    useEffect(() => {
        if (!isConnected || fetchedRef.current) return;
        fetchedRef.current = true;
        sendRpc<Capabilities>('system.capabilities', {})
            .then((result) => {
                cachedCaps = result;
                setCaps(result);
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
            });
    }, [isConnected, sendRpc]);

    return { caps, loading };
}
