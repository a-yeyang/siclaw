/**
 * Thin wrapper over @kubernetes/client-node. Centralises:
 *   - kubeconfig loading (in-cluster ServiceAccount when running as a pod,
 *     local KUBECONFIG otherwise)
 *   - a namespace allow-list — the evaluator must NEVER touch resources
 *     outside the configured eval namespace, even if an injector tries.
 */

import {
  AppsV1Api,
  CoreV1Api,
  KubeConfig,
  setHeaderOptions,
  type V1Deployment,
} from "@kubernetes/client-node";

const EVAL_MANAGED_LABEL = "eval.siclaw/managed";

export interface K8sClientOptions {
  /** Only this namespace may be mutated. All injector calls are checked. */
  allowedNamespace: string;
}

export class NamespaceViolationError extends Error {
  constructor(public readonly attempted: string, public readonly allowed: string) {
    super(`Refusing to operate on namespace "${attempted}"; evaluator is locked to "${allowed}"`);
    this.name = "NamespaceViolationError";
  }
}

export class K8sClient {
  private apps: AppsV1Api;
  private core: CoreV1Api;
  private readonly allowedNs: string;

  constructor(opts: K8sClientOptions) {
    this.allowedNs = opts.allowedNamespace;
    const kc = new KubeConfig();
    if (process.env.KUBERNETES_SERVICE_HOST) {
      kc.loadFromCluster();
    } else {
      kc.loadFromDefault();
    }
    this.apps = kc.makeApiClient(AppsV1Api);
    this.core = kc.makeApiClient(CoreV1Api);
  }

  get allowedNamespace(): string {
    return this.allowedNs;
  }

  private assertNamespace(ns: string): void {
    if (ns !== this.allowedNs) {
      throw new NamespaceViolationError(ns, this.allowedNs);
    }
  }

  async getDeployment(namespace: string, name: string): Promise<V1Deployment> {
    this.assertNamespace(namespace);
    return await this.apps.readNamespacedDeployment({ name, namespace });
  }

  /**
   * JSON-merge patches a deployment. Container patching: callers must pass a
   * full `containers` array (k8s requires it for strategic merge to identify
   * containers by name).
   */
  async patchDeployment(
    namespace: string,
    name: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    this.assertNamespace(namespace);
    const opts = setHeaderOptions("Content-Type", "application/strategic-merge-patch+json");
    await this.apps.patchNamespacedDeployment(
      { name, namespace, body: body as never },
      opts as never,
    );
  }

  /**
   * Returns the current image of the named container within the deployment.
   * Throws if not found — callers rely on this to detect typos in case YAML.
   */
  async getContainerImage(
    namespace: string,
    deployment: string,
    container: string,
  ): Promise<string> {
    const dep = await this.getDeployment(namespace, deployment);
    const containers = dep.spec?.template?.spec?.containers ?? [];
    const c = containers.find((x) => x.name === container);
    if (!c) {
      throw new Error(
        `container "${container}" not found in deployment "${namespace}/${deployment}"; existing: ${containers.map((x) => x.name).join(", ")}`,
      );
    }
    if (!c.image) {
      throw new Error(`container "${container}" has no image set`);
    }
    return c.image;
  }

  /** Returns true if the named deployment exists (without throwing on 404). */
  async deploymentExists(namespace: string, name: string): Promise<boolean> {
    this.assertNamespace(namespace);
    try {
      await this.apps.readNamespacedDeployment({ name, namespace });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Creates a minimal 1-replica Deployment with a single container.
   * The deployment is tagged with `eval.siclaw/managed=true` so it can be
   * distinguished from production workloads.
   */
  async createDeployment(
    namespace: string,
    name: string,
    containerName: string,
    image: string,
  ): Promise<void> {
    this.assertNamespace(namespace);
    const body: V1Deployment = {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: {
        name,
        namespace,
        labels: { app: name, [EVAL_MANAGED_LABEL]: "true" },
      },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: name } },
        template: {
          metadata: { labels: { app: name } },
          spec: {
            containers: [{ name: containerName, image }],
          },
        },
      },
    };
    await this.apps.createNamespacedDeployment({ namespace, body });
  }

  /**
   * Deletes a Deployment. Only permitted on deployments tagged with the
   * eval-managed label to prevent accidental deletion of production workloads.
   */
  async deleteDeployment(namespace: string, name: string): Promise<void> {
    this.assertNamespace(namespace);
    const dep = await this.getDeployment(namespace, name);
    if (dep.metadata?.labels?.[EVAL_MANAGED_LABEL] !== "true") {
      throw new Error(
        `Refusing to delete deployment "${name}": missing label ${EVAL_MANAGED_LABEL}=true. ` +
        `Only evaluator-managed deployments may be deleted.`,
      );
    }
    await this.apps.deleteNamespacedDeployment({ name, namespace });
  }

  async listPods(namespace: string, labelSelector?: string) {
    this.assertNamespace(namespace);
    return await this.core.listNamespacedPod({ namespace, labelSelector });
  }
}
