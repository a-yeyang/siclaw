#!/usr/bin/env bash
# DEPRECATED — no longer needed.
#
# The image-pull-failure injector now uses a create-and-destroy lifecycle:
# it creates the target Deployment fresh on inject and deletes it entirely
# on recover. There is no pre-existing Deployment to bootstrap.
#
# Use scripts/bootstrap-rbac.sh to set up the evaluator's RBAC instead.
echo "DEPRECATED: this script is no longer needed. See bootstrap-rbac.sh." >&2
exit 0

set -euo pipefail

NS="${NS:-siclaw}"
NAME="${NAME:-eval-image-pull-target}"
IMAGE="${IMAGE:-registry.k8s.io/pause:3.10}"

kubectl get ns "$NS" >/dev/null 2>&1 || {
  echo "namespace $NS does not exist; refusing to create one" >&2
  exit 1
}

kubectl -n "$NS" apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${NAME}
  labels:
    app.kubernetes.io/managed-by: siclaw-evaluator
    siclaw.eval/purpose: image-pull-failure-target
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${NAME}
  template:
    metadata:
      labels:
        app: ${NAME}
    spec:
      containers:
        - name: app
          image: ${IMAGE}
          imagePullPolicy: IfNotPresent
EOF

kubectl -n "$NS" rollout status deploy/"$NAME" --timeout=60s
echo "ready: ${NS}/${NAME}"
