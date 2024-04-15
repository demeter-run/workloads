import { EnvVar, ProjectSpec } from '@demeter-sdk/framework';
import type { Network, ServiceMetadata } from '@demeter-sdk/framework';
import { getService, ServiceInstanceWithStatus, getAllServices } from '../services';
import { getCardanoNodePortEnvVars } from './cardano-node-helper';

export const ENV_PREFIX_BY_KIND: Record<string, string> = {
    OgmiosPort: 'OGMIOS',
    DbSyncPort: 'DBSYNC',
    SubmitApiPort: 'SUBMIT_API',
    BlockfrostPort: 'BLOCKFROST',
    KupoPort: 'KUPO',
    CardanoNodePort: 'CARDANO_NODE',
    MarlowePort: 'MARLOWE',
    UtxoRpcPort: 'UTXO_RPC',
};

export function parseInstanceToEnvVars(instance: ServiceInstanceWithStatus, kind: string): EnvVar[] {
    switch (kind) {
        case 'CardanoNodePort':
            return getCardanoNodePortEnvVars(instance)
        case 'DbSyncPort':
            let hostname = `dbsync-v3.demeter.run`;
            let database = `dbsync-${instance.spec.network}`;
            let connectionString = `postgresql://${instance.status.username}:${instance.status.password}@${hostname}:${5432}/${database}`;
            return [
                { name: `DBSYNC_HOST`, value: hostname },
                { name: `DBSYNC_DATABASE`, value: database },
                { name: `DBSYNC_PORT`, value: 5432 },
                { name: `DBSYNC_USERNAME`, value: instance.status.username },
                { name: `DBSYNC_PASSWORD`, value: instance.status.password },
                { name: `DBSYNC_URI`, value: connectionString },
            ];
        default: {
            const prefix = ENV_PREFIX_BY_KIND[kind];
            return [
                { name: `${prefix}_API_KEY`, value: instance.status.authToken },
                { name: `${prefix}_ENDPOINT`, value: instance.status.endpointUrl },
                { name: `${prefix}_AUTHENTICATED_ENDPOINT`, value: instance.status.authenticatedEndpointUrl },
            ];
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
