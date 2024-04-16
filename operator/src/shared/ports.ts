import { EnvVar, ProjectSpec } from '@demeter-sdk/framework';
import type { Network, ServiceMetadata } from '@demeter-sdk/framework';
import { getService, ServiceInstanceWithStatus, getAllServices } from '../services';
import { getCardanoNodePortEnvVars } from './cardano-node-helper';


function removeSchema(url: string): string {
  return url.replace("https://", '').replace("http://", '')
}

export function parseInstanceToEnvVars(instance: ServiceInstanceWithStatus, kind: string): EnvVar[] {
    switch (kind) {
        case 'CardanoNodePort':
            return getCardanoNodePortEnvVars(instance)
        case 'MarlowePort':
            const rt_host = `${instance.spec.network}-${instance.spec.marlowe_version}-rt.ext-marlowe-m1.svc.cluster.local`;
            return [
                { name: "MARLOWE_RT_WEBSERVER_HOST", value: removeSchema(instance.status.authenticatedEndpointUrl)},
                { name: "MARLOWE_RT_WEBSERVER_PORT", value: "3700"},
                { name: "MARLOWE_RT_HOST", value: rt_host},
                { name: "MARLOWE_RT_PORT", value: "3701"},

            ];
        default: {
            return [];
        }
    }
}

export async function buildPortEnvVars(project: ProjectSpec, network: Network): Promise<EnvVar[]> {
    const output: EnvVar[] = [];
    const services = (await getAllServices()).filter(service => service.key.includes('port'));

    const projectInstances: { metadata: ServiceMetadata; instances: Promise<ServiceInstanceWithStatus[]> }[] = services.map(svc => {
        const service = getService(svc.key)!;
        return { metadata: service.metadata, instances: service.listProjectInstances(project) as Promise<ServiceInstanceWithStatus[]> };
    });

    console.log(projectInstances);
    for (const projectInstance of projectInstances) {
        const inst = await projectInstance.instances;
        console.log(inst);
        inst.forEach(item => {
            if (item.spec.network === network) {
                const envVars = parseInstanceToEnvVars(item, projectInstance.metadata.kind);
                output.push(...envVars);
            }
        });
    }
    return output
}
