import { makeInformer } from '@kubernetes/client-node';
import { API_VERSION, KIND } from './constants';
import { updateResourceStatus } from './handlers';
import { getClients } from '@demeter-sdk/framework';

const LABEL_SELECTOR = `demeter.run/version=${API_VERSION}, demeter.run/kind=${KIND}`;
const { client, apps } = getClients();

const listFn = () => apps.listStatefulSetForAllNamespaces(undefined, undefined, undefined, LABEL_SELECTOR);

const stsInformer = makeInformer(client, '/apis/apps/v1/statefulsets', listFn, LABEL_SELECTOR);

stsInformer.on('update', async resource => {
    console.log('SHARED - STS INFORMER UPDATE');
    await updateResourceStatus(resource.metadata?.namespace!, resource.metadata?.name!, resource);
});

stsInformer.on('error', error => console.error(error));

export default stsInformer;
