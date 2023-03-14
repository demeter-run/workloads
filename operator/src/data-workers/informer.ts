import { makeInformer } from '@kubernetes/client-node';
import { API_VERSION, KIND } from './constants';
import { podUpdated, pvcUpdated, updateResourceStatus } from './handlers';
import { getClients } from '@demeter-sdk/framework';

const LABEL_SELECTOR = `demeter.run/version=${API_VERSION}, demeter.run/kind=${KIND}`;
const { client, apps, core } = getClients();

const listFn = () => apps.listStatefulSetForAllNamespaces(undefined, undefined, undefined, LABEL_SELECTOR);

const stsInformer = makeInformer(client, '/apis/apps/v1/statefulsets', listFn, LABEL_SELECTOR);

stsInformer.on('update', async resource => {
    console.log('SHARED - STS INFORMER UPDATE');
    await updateResourceStatus(resource.metadata?.namespace!, resource.metadata?.name!, resource);
});

stsInformer.on('error', error => console.error(error));

const pvcListFn = () => core.listPersistentVolumeClaimForAllNamespaces(undefined, undefined, undefined, LABEL_SELECTOR);

const pvcInformer = makeInformer(client, '/api/v1/persistentvolumeclaims', pvcListFn, LABEL_SELECTOR);

pvcInformer.on('update', async resource => {
    console.log('SHARED - PVC UPDATED');
    try {
        await pvcUpdated(resource.metadata?.namespace!, resource.metadata?.name!, resource);
    } catch(err) {
        console.error(err);
    }
});

const podListFn = () => core.listPodForAllNamespaces(undefined, undefined, undefined, LABEL_SELECTOR);

const podInformer = makeInformer(client, '/api/v1/pods', podListFn, LABEL_SELECTOR);

podInformer.on('update', async resource => {
    console.log('SHARED - POD UPDATED');
    try {
        await podUpdated(resource.metadata?.namespace!, resource.metadata?.name!, resource);
    } catch(err) {
        console.error(err);
    }
});

export { stsInformer, pvcInformer, podInformer };