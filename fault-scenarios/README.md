# Siclaw Fault Test Catalog

> Purpose: Structured fault injection scenarios for testing Siclaw's diagnostic capabilities.
> All scenarios are single-chain causal — fix one root cause, everything recovers.
> Tested on: K8s 1.29, Calico CNI, 2 schedulable worker nodes (nodepool-061/062)
> Container image: `registry-cn-shanghai.siflow.cn/k8s-dev/busybox:latest`

## Deployment Guide

```bash
# Deploy a scenario
kubectl apply -f fault-scenarios/<scenario>.yaml

# For two-step scenarios (v06)
kubectl apply -f fault-scenarios/v06-quota-wall-step1.yaml
sleep 15  # wait for existing workloads to consume quota
kubectl apply -f fault-scenarios/v06-quota-wall-step2.yaml

# Cleanup (most scenarios)
kubectl delete ns fault-demo --wait

# Cleanup for v07 (ExternalName DNS Maze) — has an extra namespace
kubectl delete ns fault-demo auth-prod --wait

# Suggested prompt to Siclaw
# → See each scenario's "Suggested Prompt" section
```

## Scenario Index

| ID | Name | Difficulty | K8s Concepts | Siclaw Result | Layers |
|----|------|-----------|--------------|---------------|--------|
| v02 | ConfigMap Port Typo | Medium | envFrom, ConfigMap, readinessProbe | ❌ Stopped at pod layer | 4 |
| v03 | Service Name Mismatch | Medium | envFrom, ConfigMap, readinessProbe | ✅ Found root cause | 5 |
| v04 | NetworkPolicy Silent Drop | Medium-High | NetworkPolicy ingress, label mismatch | Not tested standalone | 5 |
| v05 | NetworkPolicy Blocks DNS | Medium | NetworkPolicy egress, CoreDNS | ✅ Found root cause | 5 |
| v06 | ResourceQuota + LimitRange | Hard | LimitRange injection, ResourceQuota, ReplicaSet events | ✅ Found root cause | 5 |
| v07 | ExternalName DNS Maze | Very Hard | ExternalName Service, cross-namespace | ⚠️ 2/3 found cause, 0/3 found fix | 5 |
| v08 | Ghost Endpoints | Extreme | Manual Endpoints, selector-less Service | ✅ Found root cause | 5 |
| v09 | Silent ConfigMap Override | Extreme | envFrom precedence, multiple ConfigMaps | ✅ Found root cause (2/2) | 5 |
| v10 | Startup Timeout Trap | Extreme | Liveness probe timing, ConfigMap value | ✅ Found root cause | 5 |
| v11 | Shared Config Trap | Extreme+ | Shared ConfigMap, red herring services | ✅ Found root cause | 5 |
| v12 | Mounted Config File | Extreme+ | Volume mount, shell source, phantom service | ✅ Found root cause | 5 |
| v13 | Circular Dependency Deadlock | Hard | Init containers, graph reasoning | ✅ Found circular dependency | 5 |
| v14 | Sidecar Port Collision | IMPOSSIBLE | Runtime port conflict, shared network ns, suppressed error | ✅ via follow-up | 5 |
| v15 | Credential Permission Trap | Extreme | Secret defaultMode + runAsUser conflict | ✅ Found root cause | 4 |
| v16 | Local Traffic Policy Trap | Extreme | internalTrafficPolicy: Local, node topology | ⚠️ 2/3 found cause | 5 |

## Capability Findings

### Siclaw Strengths
- **Explicit contradictions**: IP mismatch, quota numbers, DNS NXDOMAIN
- **Cross-reference validation**: Endpoint IPs vs Pod IPs, Service selector vs labels
- **K8s mechanism understanding**: ExternalName, LimitRange injection, manual Endpoints
- **Multi-ConfigMap tracing**: envFrom override precedence
- **Volume mount tracing**: Mounted config file → ConfigMap → content

### Siclaw Weaknesses
- **Implicit value tracing**: When a value (port, hostname) exists in a pod but has no visible pointer to its source (hardcoded probe, no log output)
- **Remediation discovery**: Finds "what's broken" but not always "how to fix" (e.g., finds wrong namespace but doesn't search for correct target)
- **Depth inconsistency**: Same scenario can get full diagnosis (5 layers) or stop at layer 1 depending on the run

### Key Pattern
Siclaw succeeds when there are **explicit breadcrumbs** (variable references in probes, multiple configMapRefs visible, log output showing values). It struggles when it must **proactively initiate investigation** without any visible clue pointing to the source.
