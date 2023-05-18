import { CustomResource, Backend } from '@demeter-run/workloads-types';
import Operator, { ResourceEventType, ResourceEvent } from '@dot-i/k8s-operator';
import { API_VERSION, API_GROUP, PLURAL } from './constants';
import { handleResource } from './handlers';

const RUNNING_STATUSES = ['running', 'provisioning', 'syncing', 'degraded']

export default class BackendOperator extends Operator {
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
        const object = e.object as CustomResource<Backend.Spec, Backend.Status>;
        const { metadata, spec, status } = object;
        console.log('RESOURCE CREATED', e.meta);

        // we have a status already, probably a restart is re-triggering the message. let's skip it
        if (!status) {
            await this.setResourceStatus(e.meta, {
                runningStatus: 'provisioning',
                observedGeneration: metadata?.generation,
                startTime: spec.enabled ? Date.now() : 0,
            });
        }

        // create the k8s resources needed
        await handleResource(metadata?.namespace!, metadata?.name!, spec, object);
    }

    private async resourceModified(e: ResourceEvent) {
        const object = e.object as CustomResource<Backend.Spec, Backend.Status>;
        const { metadata, status, spec } = object;
        console.log('UPDATING STATUS');
        if ((!spec.enabled && RUNNING_STATUSES.includes(status.runningStatus)) || (spec.enabled && status.runningStatus === 'paused')) {
            await this.patchResourceStatus(e.meta, {
                runningStatus: 'syncing',
                startTime: spec.enabled ? Date.now() : 0,
            });
        }
        // update the kupo resource
        await handleResource(metadata?.namespace!, metadata?.name!, spec, object);
        if (status.observedGeneration !== metadata?.generation) {
            await this.patchResourceStatus(e.meta, {
                observedGeneration: metadata?.generation,
            });
        }
    }

    private async resourceDeleted(e: ResourceEvent) {
        console.log('deleted');
    }
}
