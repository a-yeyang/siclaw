#!/usr/bin/env bash
# Creates the `eval-image-pull-target` Deployment in the `siclaw` namespace.
# Idempotent: re-running is safe. Image is a tiny pausable sleeper so the
# baseline is healthy until the evaluator injects the bad image.
#
# Requires: kubectl context pointing at the right cluster, current user has
# rights to create Deployments in `siclaw`.

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
