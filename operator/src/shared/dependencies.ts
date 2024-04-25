import { DependencyResource, listDependencies, loadDependencyConnections, Network, ProjectSpec, ServicePlugin } from '@demeter-sdk/framework';
import { V1EnvVar } from '@kubernetes/client-node';
import { getService, ServiceInstanceWithStatusAndKind } from '../services';
import { getNetworkFromAnnotations } from '.';
import { getCardanoNodeEnvVars } from './cardano-node-helper';

export async function getDependenciesForNetwork(project: ProjectSpec, network: Network) {
    const deps = await listDependencies(project);

    return deps.filter(d => getNetworkFromAnnotations(d.spec.annotations!) === network);
}

export function isCardanoNodeEnabled(deps: DependencyResource[]): boolean {
    for (const dep of deps) {
        const service = getService(dep.spec.serviceId);
        if (!service) continue;
        if (service.metadata.kind === 'CardanoNode') {
            return true;
        }
    }
    return false;
}

export function cardanoNodePort(instances: ServiceInstanceWithStatusAndKind[]): ServiceInstanceWithStatusAndKind | null{
    for (const instance of instances) {
        if (instance.kind === 'CardanoNode') {
            return instance;
        }
    }
    return null;
}

export function isCardanoNodePortEnabled(instances: ServiceInstanceWithStatusAndKind[]): boolean {
    return !!cardanoNodePort(instances);
}

export function cardanoNodeDep(deps: DependencyResource[]): { dependency: DependencyResource; service: ServicePlugin } | null {
    for (const dep of deps) {
        const service = getService(dep.spec.serviceId);
        if (!service) continue;
        if (service.metadata.kind === 'CardanoNode') {
            return { dependency: dep, service };
        }
    }
    return null;
}

export async function buildEnvVars(deps: DependencyResource[], network: Network): Promise<V1EnvVar[]> {
    const output = [];

    for (const dep of deps) {
        const service = getService(dep.spec.serviceId);
        if (!service) continue;
        if (service.metadata.kind === 'CardanoNode') {
            const envVars = getCardanoNodeEnvVars(dep, service);
            output.push(...envVars);
        }
        const connections = loadDependencyConnections(dep, service.metadata);
        for (const connection of connections) {
            if (connection.envVars) {
                output.push(...connection.envVars);
            }
        }
    }
    return output;
}
