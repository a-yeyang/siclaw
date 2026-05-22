/**
 * image-pull-failure: rewrite a target Deployment's container image to a
 * deliberately non-existent reference so K8s reports `ImagePullBackOff` /
 * `ErrImagePull` on the rolling pods.
 *
 * Recovery restores the original image. The original is captured in-memory
 * keyed by (namespace, deployment, container); a recover with no prior inject
 * is rejected to avoid silently overwriting state we never owned.
 *
 * Case YAML expects:
 *   fault:
 *     injector: image_pull_failure
 *     params:
 *       namespace: siclaw       # MUST equal evaluator's allowed ns
 *       deployment: <name>
 *       container: <name>
 *       bad_image: <optional override>
 */

import type { InjectorParams } from "./base.js";
import { FaultInjector } from "./base.js";

interface SavedImage {
  namespace: string;
  deployment: string;
  container: string;
  originalImage: string;
}

const DEFAULT_BAD_IMAGE =
  "registry.invalid.siclaw-eval/this-image-does-not-exist:fault";

export class ImagePullFailureInjector extends FaultInjector {
  readonly name = "image_pull_failure";

  /** Keyed by `ns/deployment/container` — survives only for the engine's lifetime. */
  private saved = new Map<string, SavedImage>();

  private static key(ns: string, dep: string, container: string): string {
    return `${ns}/${dep}/${container}`;
  }

  async inject_image_pull_failure(params: InjectorParams): Promise<void> {
    const { namespace, deployment, container, badImage } = this.parse(params);
    const original = await this.k8s.getContainerImage(namespace, deployment, container);
    if (original === badImage) {
      throw new Error(
        `Refusing to inject: container "${container}" already at "${badImage}" — possibly leftover state`,
      );
    }
    this.saved.set(
      ImagePullFailureInjector.key(namespace, deployment, container),
      { namespace, deployment, container, originalImage: original },
    );
    await this.patchImage(namespace, deployment, container, badImage);
  }

  async recover_image_pull_failure(params: InjectorParams): Promise<void> {
    const { namespace, deployment, container } = this.parse(params);
    const k = ImagePullFailureInjector.key(namespace, deployment, container);
    const prev = this.saved.get(k);
    if (!prev) {
      throw new Error(
        `recover_image_pull_failure called without a prior inject for ${k}`,
      );
    }
    await this.patchImage(namespace, deployment, container, prev.originalImage);
    this.saved.delete(k);
  }

  private async patchImage(
    namespace: string,
    deployment: string,
    container: string,
    image: string,
  ): Promise<void> {
    // strategic-merge needs container `name` so the array entries are merged
    // by identity rather than replaced wholesale.
    await this.k8s.patchDeployment(namespace, deployment, {
      spec: {
        template: {
          spec: {
            containers: [{ name: container, image }],
          },
        },
      },
    });
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
