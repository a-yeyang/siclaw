import type { DevEvalExperiment, DevEvalCase } from '@/hooks/useDevEval';

/** Escape a CSV cell — wrap in quotes if it contains comma, newline, or quote */
function csvCell(value: string | null | undefined): string {
    const str = value ?? '';
    if (str.includes(',') || str.includes('\n') || str.includes('"')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

export function exportAsCsv(experiment: DevEvalExperiment, cases: DevEvalCase[]): string {
    const headers = [
        'Case #',
        'Title',
        'Pod Name',
        'Namespace',
        'Fault Type',
        'Status',
        'Expected Root Cause',
        'Agent Conclusion',
        'Path Score (1-5)',
        'Conclusion Score (1-5)',
        'Score Reasoning',
        'Work Order Sent',
        'Injection Command',
    ];

    const rows = cases.map(c => {
        const workOrders = c.workOrders ?? [];
        const selectedWO = workOrders[c.selectedWorkOrder ?? 0];

        return [
            String(c.caseIndex + 1),
            c.title ?? '',
            c.podName ?? '',
            c.namespace ?? '',
            c.faultType ?? '',
            c.status,
            c.expectedAnswer ?? '',
            c.agentResponse ?? '',
            c.scoreCommands != null ? String(c.scoreCommands) : '',
            c.scoreConclusion != null ? String(c.scoreConclusion) : '',
            c.scoreReasoning ?? '',
            selectedWO?.text ?? '',
            c.kubectlInject ?? '',
        ].map(csvCell).join(',');
    });

    const meta = [
        `# DevEval Export`,
        `# Experiment ID: ${experiment.id}`,
        `# Prompt: ${csvCell(experiment.prompt)}`,
        `# Status: ${experiment.status}`,
        `# Date: ${new Date(experiment.createdAt).toISOString()}`,
        '',
    ];

    return [...meta, headers.join(','), ...rows].join('\n');
}

export function exportAsMarkdown(experiment: DevEvalExperiment, cases: DevEvalCase[]): string {
    const scoredCases = cases.filter(c => c.scoreCommands != null);
    const avgPath = scoredCases.length > 0
        ? (scoredCases.reduce((a, c) => a + (c.scoreCommands ?? 0), 0) / scoredCases.length).toFixed(1)
        : 'N/A';
    const avgConclusion = scoredCases.length > 0
        ? (scoredCases.reduce((a, c) => a + (c.scoreConclusion ?? 0), 0) / scoredCases.length).toFixed(1)
        : 'N/A';

    const lines: string[] = [
        `# DevEval Experiment Report`,
        '',
        `- **Experiment ID**: \`${experiment.id}\``,
        `- **Prompt**: ${experiment.prompt}`,
        `- **Status**: ${experiment.status}`,
        `- **Cases**: ${cases.length}`,
        `- **Date**: ${new Date(experiment.createdAt).toISOString()}`,
        `- **Avg Path Score**: ${avgPath}/5`,
        `- **Avg Conclusion Score**: ${avgConclusion}/5`,
        '',
        '---',
        '',
        '## Summary Table',
        '',
        '| # | Title | Fault Type | Status | Path | Conclusion |',
        '|---|-------|-----------|--------|------|------------|',
    ];

    for (const c of cases) {
        lines.push(
            `| ${c.caseIndex + 1} | ${c.title ?? '-'} | ${c.faultType ?? '-'} | ${c.status} | ${c.scoreCommands ?? '-'}/5 | ${c.scoreConclusion ?? '-'}/5 |`,
        );
    }

    lines.push('', '---', '');

    for (const c of cases) {
        const workOrders = c.workOrders ?? [];
        const selectedWO = workOrders[c.selectedWorkOrder ?? 0];

        lines.push(
            `## Case ${c.caseIndex + 1}: ${c.title ?? c.faultType ?? 'Untitled'}`,
            '',
            `- **Pod**: \`${c.podName ?? '-'}\``,
            `- **Namespace**: \`${c.namespace ?? '-'}\``,
            `- **Fault Type**: ${c.faultType ?? '-'}`,
            `- **Status**: ${c.status}`,
        );

        if (c.scoreCommands != null || c.scoreConclusion != null) {
            lines.push(
                `- **Path Score**: ${c.scoreCommands}/5`,
                `- **Conclusion Score**: ${c.scoreConclusion}/5`,
            );
        }
        lines.push('');

        if (c.kubectlInject) {
            lines.push('### Injection Command', '', '```bash', c.kubectlInject, '```', '');
        }

        if (c.diagnosticSteps && c.diagnosticSteps.length > 0) {
            lines.push('### Expected Diagnostic Steps', '');
            c.diagnosticSteps.forEach((s, i) => lines.push(`${i + 1}. \`${s}\``));
            lines.push('');
        }

        if (c.expectedAnswer) {
            lines.push('### Expected Root Cause', '', c.expectedAnswer, '');
        }

        if (selectedWO) {
            lines.push(`### Work Order Sent (${selectedWO.difficulty})`, '', `> ${selectedWO.text}`, '');
        }

        if (c.agentResponse) {
            lines.push('### Agent Response', '', c.agentResponse, '');
        }

        if (c.agentCommands && c.agentCommands.length > 0) {
            lines.push('### Agent Commands', '');
            c.agentCommands.forEach(cmd => lines.push(`- \`${cmd}\``));
            lines.push('');
        }

        if (c.scoreReasoning) {
            lines.push('### Score Reasoning', '', c.scoreReasoning, '');
        }

        lines.push('---', '');
    }

    return lines.join('\n');
}
