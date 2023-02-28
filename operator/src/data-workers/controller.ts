import { CustomResource, DataWorker } from '@demeter-run/workloads-types';
import Operator, { ResourceEventType, ResourceEvent } from '@dot-i/k8s-operator';
import { API_VERSION, API_GROUP, PLURAL } from './constants';
import { handleResource, deletePVC, updateResource } from './handlers';

export default class KupoOperator extends Operator {
    constructor() {
        super(/* pass in optional logger*/);
    }

    protected async init() {
        try {
            await this.watchResource(API_GROUP, API_VERSION, PLURAL, async e => {
                try {
                    switch (e.type) {
                        case ResourceEventType.Added:
                            await this.resourceCreated(e);
                            break;
                        case ResourceEventType.Modified:
                            await this.resourceModified(e);
                            break;
                        case ResourceEventType.Deleted:
                            await this.resourceDeleted(e);
                            break;
                    }
                } catch (err) {
                    console.log(err);
                }
            });
        } catch (err) {
            console.log(err);
        }
    }

    private async resourceCreated(e: ResourceEvent) {
        const object = e.object as CustomResource<DataWorker.Spec, DataWorker.Status>;
        const { metadata, spec, status } = object;
        console.log('RESOURCE CREATED', e.meta);

        // we have a status already, probably a restart is re-triggering the message. let's skip it
        if (status) {
            return;
        }

        // set the default values for status.
        await this.setResourceStatus(e.meta, {
            privateDns: `${metadata?.name}.${metadata?.namespace!}.svc.cluster.local`,
            runningStatus: 'provisioning',
            observedGeneration: metadata?.generation,
        });

        // create the k8s resources needed
        await handleResource(metadata?.namespace!, metadata?.name!, spec, object);
    }

    private async resourceModified(e: ResourceEvent) {
        const object = e.object as CustomResource<DataWorker.Spec, DataWorker.Status>;
        const { metadata, status, spec } = object;
        console.log('UPDATING STATUS', status);
        if ((!spec.enabled && status.runningStatus === 'running') || (spec.enabled && status.runningStatus === 'paused')) {
            await this.setResourceStatus(e.meta, {
                ...status,
                runningStatus: 'syncing',
            });
        }
        // update the kupo resource
        await handleResource(metadata?.namespace!, metadata?.name!, spec, object);
        if (!object.status || object.status.observedGeneration !== metadata?.generation) {
            await this.setResourceStatus(e.meta, {
                ...status,
                observedGeneration: metadata?.generation,
            });
        }
    }

    private async resourceDeleted(e: ResourceEvent) {
        console.log('deleted');
        // const { metadata } = e.object as CustomResource<DataWorker.Spec, DataWorker.Status>;
        // await deletePVC(metadata?.namespace!, metadata?.name!);
    }
}
