import { EnvVar, ProjectSpec } from '@demeter-sdk/framework';
import type { Network, ServiceMetadata } from '@demeter-sdk/framework';
import { getService, ServiceInstanceWithStatus, ServiceInstanceWithStatusAndKind, getAllServices } from '../services';
import { getCardanoNodePortEnvVars } from './cardano-node-helper';

function removeSchema(url: string): string {
    return url.replace('https://', '').replace('http://', '');
}

const DEFAULT_MARLOWE_VERSION = 'patch6';

export async function getPortsForNetwork(project: ProjectSpec, network: Network): Promise<ServiceInstanceWithStatusAndKind[]> {
    const output: ServiceInstanceWithStatusAndKind[] = [];
    const services = (await getAllServices()).filter(service => service.key.includes('port'));

    const projectInstances: { metadata: ServiceMetadata; instances: Promise<ServiceInstanceWithStatus[]> }[] = services.map(svc => {
        const service = getService(svc.key)!;
        return { metadata: service.metadata, instances: service.listProjectInstances(project) as Promise<ServiceInstanceWithStatus[]> };
    });

    for (const projectInstance of projectInstances) {
        const inst = await projectInstance.instances;
        inst.forEach(instance => {
            if (instance.spec.network.replace('cardano-', '') === network) {
                output.push({ ...instance, kind: projectInstance.metadata.kind });
            }
        });
        output.push();
    }
    return output;
}

export function parseInstanceToEnvVars(instance: ServiceInstanceWithStatusAndKind): EnvVar[] {
    switch (instance.kind) {
        case 'CardanoNodePort':
            return getCardanoNodePortEnvVars(instance);
        case 'MarlowePort':
            const rt_host = `${instance.spec.network}-${instance.spec.marloweVersion || DEFAULT_MARLOWE_VERSION}-rt.ext-marlowe-m1.svc.cluster.local`;
            return [
                { name: 'MARLOWE_RT_WEBSERVER_HOST', value: removeSchema(instance.status.authenticatedEndpointUrl) },
                { name: 'MARLOWE_RT_WEBSERVER_PORT', value: '443' },
                { name: 'MARLOWE_RT_HOST', value: rt_host },
                { name: 'MARLOWE_RT_PORT', value: '3700' },
            ];
        default: {
            return [];
        }
    }
}

export async function buildPortEnvVars(instances: ServiceInstanceWithStatusAndKind[]): Promise<EnvVar[]> {
    const output: EnvVar[] = [];
    instances.forEach(item => {
        const envVars = parseInstanceToEnvVars(item);
        output.push(...envVars);
    });
    return output;
}

export function portExists(instances: ServiceInstanceWithStatusAndKind[], kind: string): ServiceInstanceWithStatusAndKind | null {
    for (const instance of instances) {
        if (instance.kind === kind) {
            return instance;
        }
    }
    return null;
}

