import { ServiceMetadata, ServicePlugin } from '@demeter-sdk/framework';
import { getServicePlugin } from '@demeter-sdk/framework';
import { registerService } from '@demeter-sdk/framework';
import { SERVICE_PLUGIN as submitApiService } from '@demeter-features/cardano-submit-api';
import { SERVICE_PLUGIN as nodesService } from '@demeter-features/cardano-nodes';
import { SERVICE_PLUGIN as kuberService } from '@demeter-features/cardano-kuber';
import { SERVICE_PLUGIN as blockfrostService } from '@demeter-features/cardano-blockfrost';
import { SERVICE_PLUGIN as ogmiosService } from '@demeter-features/cardano-ogmios';
import { SERVICE_PLUGIN as dBSyncService } from '@demeter-features/cardano-dbsync';
import { SERVICE_PLUGIN as kupoService } from '@demeter-features/cardano-kupo';
import { SERVICE_PLUGIN as marloweService } from '@demeter-features/cardano-marlowe';
import { V2 as dbSyncV2 } from '@demeter-features/cardano-dbsync';
import { V2 as nodesV2 } from '@demeter-features/cardano-nodes';
const dbSyncServiceV2 = dbSyncV2.SERVICE_PLUGIN;
const nodesServiceV2 = nodesV2.SERVICE_PLUGIN;

/**
 * Returns the metadata for a service given a service id
 * @param id 
 * @returns 
 */
export function getServiceMetadata(id: string): ServiceMetadata {
  const service = getServicePlugin(id);

  if (!service) throw new Error(`Service with id: ${id} was not found`);

  return service.metadata;
}

/**
 * Returns the reference to the service plugin given a service id
 * @param id 
 * @returns 
 */
export function getService(id: string): ServicePlugin {
  const service = getServicePlugin(id);
  if (!service) throw new Error(`Service with id: ${id} was not found`);
  return service;
}


/**
 * The console has awareness of the service and is responsible of 
 * registering the services available with access from its user interface
 */
export function registerServices() {
  registerService(submitApiService);
  registerService(nodesService);
  registerService(ogmiosService);
  registerService(kuberService);
  registerService(kupoService);
  registerService(blockfrostService);
  registerService(dBSyncService);
  registerService(marloweService);
  registerService(dbSyncServiceV2);
  registerService(nodesServiceV2);
}
