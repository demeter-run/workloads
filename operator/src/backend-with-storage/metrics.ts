import type { CustomResource, BackendWithStorage } from "@demeter-run/workloads-types";
import { collectWorkloadMetrics } from "../metrics/project";
import { loadProjectInstances } from "../shared";
import { API_GROUP, API_VERSION, PLURAL } from "./constants";


async function collectCustomExtensionsMetrics() {
  // @TODO paginate this query
  const instances = await loadProjectInstances(API_GROUP, API_VERSION, PLURAL) as CustomResource<BackendWithStorage.Spec, BackendWithStorage.Status>[];

  for (const instance of instances) {
    await collectWorkloadMetrics(instance);
  }
}

export async function collectClusterMetrics() {
  await collectCustomExtensionsMetrics();
}
