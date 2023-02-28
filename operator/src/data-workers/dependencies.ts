import { DependencyResource, listDependencies, loadDependencyConnections, Network, ProjectSpec } from "@demeter-sdk/framework";
import { V1EnvVar } from "@kubernetes/client-node";
import * as nodes from '@demeter-features/cardano-nodes';
import { getService } from "../services";

export function getNetworkFromAnnotations(annotations: Record<string, string>) {
  if ('cardano.demeter.run/network' in annotations) {
    return annotations['cardano.demeter.run/network'];
  }
  return '';
}

export async function getDependenciesForNetwork(project: ProjectSpec, network: Network) {
  const deps = await listDependencies(project);

  return deps.filter(d => getNetworkFromAnnotations(d.spec.annotations!) === network)

}

export function isCardanoNodeEnabled(deps: DependencyResource[]): boolean {
  for (const dep of deps) {
    const service = getService(dep.spec.serviceId);
    if (service.metadata.kind === 'CardanoNode') {
      return true;
    }
  }
  return false;
}

export async function buildEnvVars(deps: DependencyResource[], network: Network): Promise<V1EnvVar[]> {
  const output = [];

  let usesCardanoNode = false;
  for (const dep of deps) {
    const service = getService(dep.spec.serviceId);
    if (service.metadata.kind === 'CardanoNode') {
      usesCardanoNode = true;
    }
    const connections = loadDependencyConnections(dep, service.metadata);
    for (const connection of connections) {
      if (connection.envVars) {
        output.push(...connection.envVars)
      }
    }
  }

  if (usesCardanoNode) {
    // load cardano node env vars
    const node = await nodes.getInjectableEnvVars(network);
    output.push(...node);
  }

  return output;

}
