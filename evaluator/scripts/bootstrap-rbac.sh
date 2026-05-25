#!/usr/bin/env bash
# Applies the evaluator's ServiceAccount, Role, and RoleBinding to the cluster.
# Idempotent: re-running is safe.
#
# The Role grants:
#   apps/deployments  — get, list, patch, create, delete
#     (create + delete needed for the create-and-destroy fault lifecycle)
#   core/pods,events  — get, list
#
# Requires: kubectl context pointing at the right cluster, current user has
# rights to manage RBAC in the `siclaw` namespace.

set -euo pipefail

NS="${NS:-siclaw}"
SA="${SA:-siclaw-evaluator}"

kubectl apply -f - <<EOF
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${SA}
  namespace: ${NS}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${SA}
  namespace: ${NS}
rules:
  - apiGroups: ["apps"]
    resources: ["deployments"]
    verbs: ["get", "list", "patch", "create", "delete"]
  - apiGroups: [""]
    resources: ["pods", "events"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${SA}
  namespace: ${NS}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: ${SA}
subjects:
  - kind: ServiceAccount
    name: ${SA}
    namespace: ${NS}
EOF

echo "RBAC applied: namespace=${NS} serviceAccount=${SA}"
