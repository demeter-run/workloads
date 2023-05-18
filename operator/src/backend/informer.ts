import { makeInformer } from '@kubernetes/client-node';
import { API_VERSION, KIND } from './constants';
import { updateResourceStatus } from './handlers';
import { getClients } from '@demeter-sdk/framework';

const LABEL_SELECTOR = `demeter.run/version=${API_VERSION}, demeter.run/kind=${KIND}`;
const { client, apps, core } = getClients();

const listFn = () => apps.listDeploymentForAllNamespaces(undefined, undefined, undefined, LABEL_SELECTOR);

const stsInformer = makeInformer(client, '/apis/apps/v1/deployments', listFn, LABEL_SELECTOR);

stsInformer.on('update', async resource => {
    console.log('SHARED - Deployment INFORMER UPDATE');
    try {
        await updateResourceStatus(resource.metadata?.namespace!, resource.metadata?.name!, resource);
    } catch (err) {
        console.error(err);
    }
});

stsInformer.on('error', error => console.error(error));

export { stsInformer };
