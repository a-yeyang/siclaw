#!/usr/bin/env bash
# ==============================================================================
# Siclaw K8s 部署脚本（main 分支裸跑版）
# ==============================================================================
#
# 目的：
#   独立部署一份 main 分支的 portal/runtime/agentbox，**不接 trace MySQL**，用来
#   验证某些问题（比如 chat 不响应）是不是 main 分支自己的 bug，与 trace-store
#   分支的改动无关。
#
# 与 deploy-k8s.sh 的区别：
#   1. 不读 SICLAW_TRACE_* env，不传 trace 相关 helm values
#   2. 默认部到独立 namespace `siclaw-main`，与 `siclaw` 隔离不互相干扰
#   3. 默认读 `scripts/images-main.txt`
#
# 前置条件：
#   1. helm（v3.x）/ kubectl / openssl 已安装
#   2. 镜像清单 scripts/images-main.txt 已就位，格式：每行一个镜像 ref，三个
#      组件（portal/runtime/agentbox）必须共享同一 registry+tag。例：
#        registry-cn-beijing.siflow.cn/k8s/siclaw-portal:main-5a67f39
#        registry-cn-beijing.siflow.cn/k8s/siclaw-runtime:main-5a67f39
#        registry-cn-beijing.siflow.cn/k8s/siclaw-agentbox:main-5a67f39
#
# 使用：
#   ./scripts/deploy-k8s-main.sh                                # 默认读 scripts/images-main.txt
#   ./scripts/deploy-k8s-main.sh -f /path/to/other-images.txt   # 显式指定
#   NAMESPACE=siclaw-foo ./scripts/deploy-k8s-main.sh           # 换 namespace
#   FORCE_RESEED=1 ./scripts/deploy-k8s-main.sh                 # 强制重新生成 secret
#   SKIP_PORTFORWARD=1 ./scripts/deploy-k8s-main.sh             # 不自动启 port-forward
#
# 部署后访问：
#   脚本默认会启动一个 port-forward 到 0.0.0.0:3013（避免和 deploy-k8s.sh 的 3003 冲突）
#   Mac 浏览器开 http://<DEV-MACHINE-IP>:3013
# ==============================================================================

set -euo pipefail

# ── 解析命令行参数 ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGES_FILE="${SCRIPT_DIR}/images-main.txt"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -f|--file) IMAGES_FILE="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^# =====/p' "$0" | sed 's/^# \?//' | head -n 40
      exit 0
      ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── 默认配置 ────────────────────────────────────────────────────────────────
NAMESPACE="${NAMESPACE:-siclaw-main}"
RELEASE_NAME="${RELEASE_NAME:-siclaw-main}"
SECRETS_FILE="${SECRETS_FILE:-$HOME/.siclaw-main-deploy-secrets.env}"
PORTFORWARD_PORT="${PORTFORWARD_PORT:-3013}"
PORTFORWARD_PID_FILE="${PORTFORWARD_PID_FILE:-/tmp/siclaw-main-portforward.pid}"

CHART_DIR="${SCRIPT_DIR}/../helm/siclaw"

# ── 工具检查 ────────────────────────────────────────────────────────────────
command -v helm >/dev/null    || { echo "ERROR: helm not found"; exit 1; }
command -v kubectl >/dev/null || { echo "ERROR: kubectl not found"; exit 1; }
command -v openssl >/dev/null || { echo "ERROR: openssl not found"; exit 1; }
[[ -d "$CHART_DIR" ]]         || { echo "ERROR: chart dir not found: $CHART_DIR"; exit 1; }
[[ -f "$IMAGES_FILE" ]]       || { echo "ERROR: images file not found: $IMAGES_FILE"; exit 1; }

# ── 解析镜像清单 ────────────────────────────────────────────────────────────
declare -A SEEN_COMPONENTS=()
IMAGE_REGISTRY=""
IMAGE_TAG=""

while IFS= read -r line; do
  line="${line%%#*}"
  line="$(echo "$line" | xargs)"
  [[ -z "$line" ]] && continue

  if [[ "$line" =~ ^(.+)/(siclaw-(portal|runtime|agentbox)):(.+)$ ]]; then
    reg="${BASH_REMATCH[1]}"
    component="${BASH_REMATCH[3]}"
    tag="${BASH_REMATCH[4]}"
  else
    echo "ERROR: malformed line in $IMAGES_FILE:"
    echo "  $line"
    echo "Expected: <registry>/siclaw-{portal|runtime|agentbox}:<tag>"
    exit 1
  fi

  if [[ -z "$IMAGE_REGISTRY" ]]; then
    IMAGE_REGISTRY="$reg"
    IMAGE_TAG="$tag"
  else
    [[ "$reg" == "$IMAGE_REGISTRY" ]] || { echo "ERROR: registry mismatch — $reg vs $IMAGE_REGISTRY"; exit 1; }
    [[ "$tag" == "$IMAGE_TAG" ]]      || { echo "ERROR: tag mismatch — $tag vs $IMAGE_TAG"; exit 1; }
  fi
  SEEN_COMPONENTS[$component]=1
done < "$IMAGES_FILE"

for c in portal runtime agentbox; do
  [[ -n "${SEEN_COMPONENTS[$c]:-}" ]] || { echo "ERROR: missing siclaw-$c in $IMAGES_FILE"; exit 1; }
done

# ── 打印部署上下文 ──────────────────────────────────────────────────────────
echo "============================================================"
echo "Mode        : main-only (no trace MySQL)"
echo "Images file : $IMAGES_FILE"
echo "Registry    : $IMAGE_REGISTRY"
echo "Tag         : $IMAGE_TAG"
echo "Namespace   : $NAMESPACE"
echo "Release     : $RELEASE_NAME"
echo "kubectl ctx : $(kubectl config current-context)"
echo "PF Port     : ${PORTFORWARD_PORT}"
echo "============================================================"

# ── 加载或生成 secret（独立于 deploy-k8s.sh 的那份） ────────────────────────
if [[ "${FORCE_RESEED:-0}" == "1" ]] || [[ ! -f "$SECRETS_FILE" ]]; then
  if [[ -f "$SECRETS_FILE" ]]; then
    cp "$SECRETS_FILE" "${SECRETS_FILE}.bak-$(date +%s)"
    echo "Backed up old secrets to ${SECRETS_FILE}.bak-*"
  fi
  echo "Generating new secrets → $SECRETS_FILE"
  cat > "$SECRETS_FILE" <<EOF
JWT=$(openssl rand -hex 32)
RT=$(openssl rand -hex 32)
PT=$(openssl rand -hex 32)
DB_PASS=$(openssl rand -hex 16)
EOF
  chmod 600 "$SECRETS_FILE"
else
  echo "Reusing secrets from $SECRETS_FILE"
fi
# shellcheck disable=SC1090
source "$SECRETS_FILE"

# ── 确保 namespace 存在 ─────────────────────────────────────────────────────
kubectl get ns "$NAMESPACE" >/dev/null 2>&1 \
  || kubectl create namespace "$NAMESPACE"

# ── helm upgrade --install（不带任何 trace env） ────────────────────────────
helm upgrade --install "$RELEASE_NAME" "$CHART_DIR" \
  -n "$NAMESPACE" \
  -f "${CHART_DIR}/values-standalone.yaml" \
  --set image.registry="$IMAGE_REGISTRY" \
  --set image.tag="$IMAGE_TAG" \
  --set image.pullPolicy=Always \
  --set mysql.enabled=true \
  --set mysql.password="$DB_PASS" \
  --set database.url="mysql://siclaw:$DB_PASS@siclaw-main-mysql:3306/siclaw" \
  --set runtime.jwtSecret="$JWT"     --set portal.jwtSecret="$JWT" \
  --set runtime.runtimeSecret="$RT"  --set portal.runtimeSecret="$RT" \
  --set runtime.portalSecret="$PT"   --set portal.portalSecret="$PT" \
  --set portal.service.nodePort=31013   # 避免和 deploy-k8s.sh 的 31003 撞

# ── 强制重拉镜像 + 清掉旧 agentbox ──────────────────────────────────────────
echo "Forcing pod restart to ensure latest images are pulled..."
kubectl rollout restart -n "$NAMESPACE" deploy/siclaw-main-portal  >/dev/null 2>&1 || true
kubectl rollout restart -n "$NAMESPACE" deploy/siclaw-main-runtime >/dev/null 2>&1 || true
kubectl delete pod -n "$NAMESPACE" \
  -l 'siclaw.io/app=agentbox' --ignore-not-found >/dev/null 2>&1 || true

# ── migrate.ts FK 顺序 bug 绕过 ────────────────────────────────────────────
echo "Waiting for MySQL ready..."
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/component=mysql \
  -n "$NAMESPACE" --timeout=180s || true

echo "Disabling MySQL FOREIGN_KEY_CHECKS (works around migrate.ts ordering bug)..."
kubectl exec -n "$NAMESPACE" deploy/siclaw-main-mysql -- \
  mysql -uroot -p"$DB_PASS" -e "SET GLOBAL FOREIGN_KEY_CHECKS=0;" 2>/dev/null \
  || echo "  (skipped — mysql not accepting connections yet)"

kubectl rollout restart -n "$NAMESPACE" deploy/siclaw-main-portal >/dev/null

# ── 等 rollout 完成 ─────────────────────────────────────────────────────────
echo "Waiting for portal / runtime rollouts..."
kubectl rollout status -n "$NAMESPACE" deploy/siclaw-main-portal  --timeout=180s || true
kubectl rollout status -n "$NAMESPACE" deploy/siclaw-main-runtime --timeout=180s || true

# ── port-forward ────────────────────────────────────────────────────────────
if [[ "${SKIP_PORTFORWARD:-0}" != "1" ]]; then
  if [[ -f "$PORTFORWARD_PID_FILE" ]]; then
    OLD_PID="$(cat "$PORTFORWARD_PID_FILE" 2>/dev/null || true)"
    if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
      kill "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$PORTFORWARD_PID_FILE"
  fi

  echo "Waiting for portal endpoints to stabilize..."
  for i in $(seq 1 30); do
    bad="$(kubectl get pods -n "$NAMESPACE" \
            -l app.kubernetes.io/component=portal \
            --no-headers 2>/dev/null | awk '$3!="Running"' | wc -l)"
    [[ "$bad" == "0" ]] && break
    sleep 2
  done

  echo "Starting port-forward (svc/siclaw-main-portal:3003 → 0.0.0.0:${PORTFORWARD_PORT})..."
  nohup kubectl port-forward -n "$NAMESPACE" --address 0.0.0.0 \
    svc/siclaw-main-portal "${PORTFORWARD_PORT}:3003" \
    > /tmp/siclaw-main-portforward.log 2>&1 &
  echo $! > "$PORTFORWARD_PID_FILE"

  for i in $(seq 1 10); do
    sleep 1
    if curl -fsSI -m 1 "http://localhost:${PORTFORWARD_PORT}" >/dev/null 2>&1; then
      break
    fi
  done

  DEV_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [[ -z "$DEV_IP" ]] && DEV_IP="<DEV-MACHINE-IP>"
fi

# ── 收尾 ────────────────────────────────────────────────────────────────────
echo
echo "============================================================"
echo "Deploy complete."
kubectl get pods -n "$NAMESPACE"
echo "============================================================"

if [[ "${SKIP_PORTFORWARD:-0}" != "1" ]]; then
  cat <<EOF

✅ main-only deploy is live. From your Mac:

  1) Same internal network as $DEV_IP:
       http://${DEV_IP}:${PORTFORWARD_PORT}

  2) Otherwise SSH tunnel:
       ssh -L ${PORTFORWARD_PORT}:localhost:${PORTFORWARD_PORT} yye@${DEV_IP}
       open http://localhost:${PORTFORWARD_PORT}

First-time login? Register the admin account first:
  curl -X POST http://localhost:${PORTFORWARD_PORT}/api/v1/auth/register \\
    -H 'Content-Type: application/json' \\
    -d '{"username":"admin","password":"admin"}'

This release is fully isolated from the trace-store deployment:
  - Namespace : $NAMESPACE
  - Release   : $RELEASE_NAME
  - PF Port   : ${PORTFORWARD_PORT}
  - Secrets   : $SECRETS_FILE

Stop port-forward:
  kill \$(cat $PORTFORWARD_PID_FILE)

Tear down everything:
  helm uninstall $RELEASE_NAME -n $NAMESPACE
  kubectl delete pvc --all -n $NAMESPACE
  kubectl delete namespace $NAMESPACE
EOF
fi
