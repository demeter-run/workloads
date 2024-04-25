import { ServiceMetadata, ServicePlugin, ServiceInstance, getAllRegisteredServiceIds } from '@demeter-sdk/framework';
import { getServicePlugin } from '@demeter-sdk/framework';
import { registerService } from '@demeter-sdk/framework';
import { SERVICE_PLUGIN as submitApiService } from '@demeter-features/cardano-submit-api';
import { SERVICE_PLUGIN as nodePortService } from '@demeter-features/cardano-node-port';
import { SERVICE_PLUGIN as blockfrostService } from '@demeter-features/cardano-blockfrost';
import { SERVICE_PLUGIN as ogmiosService } from '@demeter-features/cardano-ogmios';
import { SERVICE_PLUGIN as marloweService } from '@demeter-features/cardano-marlowe';
import { SERVICE_PLUGIN as marlowePortService } from '@demeter-features/cardano-marlowe-port';
import { V2 as nodesV2 } from '@demeter-features/cardano-nodes';
const nodesServiceV2 = nodesV2.SERVICE_PLUGIN;


export type ServiceInstanceWithStatus = ServiceInstance & { status: any; spec: any };
export type ServiceInstanceWithStatusAndKind = ServiceInstanceWithStatus & { kind: string };

/**
 * Returns all the registered services metadata
 * @returns
 */
export async function getAllServices(): Promise<ServiceMetadata[]> {
    const serviceIds = getAllRegisteredServiceIds();

    const res: ServiceMetadata[] = [];

    // checks the service feature flag is enabled
    for (const id of serviceIds) {
        const metadata = getServiceMetadata(id);
        if (metadata) {
            res.push(metadata);
        }
    }

    return res;
}


/**
 * Returns the metadata for a service given a service id
 * @param id
 * @returns
 */
export function getServiceMetadata(id: string): ServiceMetadata | null {
    const service = getServicePlugin(id);

    if (!service) return null;

    return service.metadata;
}

/**
 * Returns the reference to the service plugin given a service id
 * @param id
 * @returns
 */
export function getService(id: string): ServicePlugin | null {
    const service = getServicePlugin(id);

    if (!service) return null;
    return service;
}

/**
 * The console has awareness of the service and is responsible of
 * registering the services available with access from its user interface
 */
export function registerServices() {
    registerService(submitApiService);
    registerService(nodePortService);
    registerService(ogmiosService);
    registerService(blockfrostService);
    registerService(marlowePortService);
    registerService(marloweService);
    registerService(nodesServiceV2);
}
