import { useState, useCallback } from 'react';

export interface DevEvalExperiment {
  id: string;
  userId: string;
  workspaceId: string;
  prompt: string;
  caseCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DevEvalWorkOrder {
  difficulty: string;
  text: string;
}

export interface DevEvalCase {
  id: string;
  experimentId: string;
  caseIndex: number;
  title: string | null;
  podName: string | null;
  namespace: string | null;
  faultType: string | null;
  kubectlInject: string | null;
  diagnosticSteps: string[] | null;
  expectedAnswer: string | null;
  workOrders: DevEvalWorkOrder[] | null;
  selectedWorkOrder: number | null;
  agentSessionId: string | null;
  agentResponse: string | null;
  agentCommands: string[] | null;
  scoreCommands: number | null;
  scoreConclusion: number | null;
  scoreReasoning: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

export function useDevEval(
  sendRpc: <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>,
) {
  const [experiments, setExperiments] = useState<DevEvalExperiment[]>([]);
  const [currentExperiment, setCurrentExperiment] = useState<DevEvalExperiment | null>(null);
  const [cases, setCases] = useState<DevEvalCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadExperiments = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await sendRpc<{ experiments: DevEvalExperiment[] }>('deveval.list');
      setExperiments(result.experiments ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sendRpc]);

  const loadExperiment = useCallback(async (experimentId: string) => {
    setError(null);
    setLoading(true);
    try {
      const result = await sendRpc<{ experiment: DevEvalExperiment; cases: DevEvalCase[] }>(
        'deveval.get',
        { experimentId },
      );
      setCurrentExperiment(result.experiment);
      setCases(result.cases ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sendRpc]);

  const generate = useCallback(async (opts: {
    prompt: string;
    workspaceId?: string;
    namespace?: string;
    caseCount?: number;
    modelProvider?: string;
    modelId?: string;
  }) => {
    setError(null);
    try {
      const result = await sendRpc<{ experimentId: string; status: string }>('deveval.generate', opts);
      return result.experimentId;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    }
  }, [sendRpc]);

  const inject = useCallback(async (experimentId: string) => {
    setError(null);
    try {
      await sendRpc('deveval.inject', { experimentId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [sendRpc]);

  const run = useCallback(async (experimentId: string, opts?: {
    modelProvider?: string;
    modelId?: string;
  }) => {
    setError(null);
    try {
      await sendRpc('deveval.run', { experimentId, ...opts });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [sendRpc]);

  const score = useCallback(async (experimentId: string, opts?: {
    modelProvider?: string;
    modelId?: string;
  }) => {
    setError(null);
    try {
      await sendRpc('deveval.score', { experimentId, ...opts });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }, [sendRpc]);

  const deleteExperiment = useCallback(async (experimentId: string) => {
    setError(null);
    try {
      await sendRpc('deveval.delete', { experimentId });
      setExperiments(prev => prev.filter(e => e.id !== experimentId));
      if (currentExperiment?.id === experimentId) {
        setCurrentExperiment(null);
        setCases([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sendRpc, currentExperiment]);

  const updateWorkOrder = useCallback(async (caseId: string, selectedIndex: number) => {
    try {
      await sendRpc('deveval.updateWorkOrder', { caseId, selectedIndex });
      setCases(prev => prev.map(c =>
        c.id === caseId ? { ...c, selectedWorkOrder: selectedIndex } : c,
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [sendRpc]);

  return {
    experiments,
    currentExperiment,
    cases,
    loading,
    error,
    loadExperiments,
    loadExperiment,
    generate,
    inject,
    run,
    score,
    deleteExperiment,
    updateWorkOrder,
  };
}
