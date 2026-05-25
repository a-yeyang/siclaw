/**
 * image-pull-failure: creates a fresh Deployment whose container image is
 * deliberately non-existent, so K8s reports `ImagePullBackOff` / `ErrImagePull`
 * on the resulting pod.
 *
 * Lifecycle:
 *   inject  → delete pre-existing deployment (if any), then CREATE a new one
 *             with the bad image.
 *   recover → DELETE the deployment entirely — the environment is left clean.
 *
 * This "create and destroy" lifecycle means:
 *  - No bootstrap script is needed; the deployment is created on first inject.
 *  - Recovery is a hard delete, so subsequent runs always start fresh.
 *  - Safety: K8sClient.deleteDeployment() refuses to touch deployments that
 *    lack the `eval.siclaw/managed=true` label, preventing accidents.
 *
 * Case YAML:
 *   fault:
 *     injector: image_pull_failure
 *     params:
 *       namespace: siclaw
 *       deployment: eval-image-pull-target
 *       container: app
 *       bad_image: <optional override>
 */

import type { InjectorParams } from "./base.js";
import { FaultInjector } from "./base.js";

const DEFAULT_BAD_IMAGE =
  "registry.invalid.siclaw-eval/this-image-does-not-exist:fault";

export class ImagePullFailureInjector extends FaultInjector {
  readonly name = "image_pull_failure";

  async inject_image_pull_failure(params: InjectorParams): Promise<void> {
    const { namespace, deployment, container, badImage } = this.parse(params);

    // Delete any pre-existing deployment (idempotent cleanup from a prior run).
    if (await this.k8s.deploymentExists(namespace, deployment)) {
      await this.k8s.deleteDeployment(namespace, deployment);
      // Brief pause to let the controller process the deletion before create.
      await sleep(2000);
    }

    await this.k8s.createDeployment(namespace, deployment, container, badImage);
  }

  async recover_image_pull_failure(params: InjectorParams): Promise<void> {
    const { namespace, deployment } = this.parse(params);
    if (await this.k8s.deploymentExists(namespace, deployment)) {
      await this.k8s.deleteDeployment(namespace, deployment);
    }
    // If it no longer exists (e.g. manual cleanup happened), recovery is a no-op.
  }

  private parse(params: InjectorParams): {
    namespace: string;
    deployment: string;
    container: string;
    badImage: string;
  } {
    const namespace = requireString(params, "namespace");
    if (namespace !== this.k8s.allowedNamespace) {
      throw new Error(
        `image_pull_failure: namespace "${namespace}" outside allowed "${this.k8s.allowedNamespace}"`,
      );
    }
    const deployment = requireString(params, "deployment");
    const container = requireString(params, "container");
    const badImage =
      typeof params.bad_image === "string" && params.bad_image.length > 0
        ? params.bad_image
        : DEFAULT_BAD_IMAGE;
    return { namespace, deployment, container, badImage };
  }
}

function requireString(p: InjectorParams, key: string): string {
  const v = p[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`image_pull_failure: param "${key}" required (non-empty string)`);
  }
  return v;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
