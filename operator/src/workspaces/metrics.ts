import type { CustomResource, GenericWorkload, MetricsStatus, Workspace } from '@demeter-run/workloads-types';
import axios from 'axios';
import { buildPayload, trackAge, trackRestartCount, trackStatus, trackStorageDCU, updateCache } from '../metrics/project';
import { lastActivityGauge } from '../metrics/prometheus';
import { loadProjectInstances } from '../shared';
import { API_GROUP, API_VERSION, PLURAL } from './constants';
import { updateResourceLastActivity } from './handlers';

interface StatusResource extends CustomResource<Workspace.Spec, Workspace.Status> {
    lastChecked: number;
    upTime: number;
}

async function trackLastActivity(item: StatusResource) {
    const url = item.status.healthUrl;
    try {
        const { data } = await axios.get(url);
        if (data) {
            const payload = buildPayload(item);
            const lastActivity = data.lastHeartbeat !== 0 ? Math.round(data.lastHeartbeat / 1000) : 0;
            lastActivityGauge.set(payload, lastActivity);
            updateResourceLastActivity(item, lastActivity);
        }
    } catch (error: any) {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.log(error.response.data);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.log('Error', error.message);
        }
        updateResourceLastActivity(item, 0);
    }
}

export async function collectWorkloadMetrics(item: CustomResource<GenericWorkload, MetricsStatus>) {
    // we need a lastChecked to compute storage DCU
    const statusItem = item as unknown as StatusResource;
    statusItem.lastChecked = Date.now();
    trackStatus(statusItem);
    if (item.status.storageDCUPerMin) {
        trackStorageDCU(statusItem);
    }

    if (item.status.runningStatus === 'running') {
        const age = trackAge(statusItem);
        if (age) {
            statusItem.upTime = age;
            await trackLastActivity(statusItem);
        }
        trackRestartCount(statusItem);
    }

    updateCache(statusItem);
}

async function collectCustomExtensionsMetrics() {
    // @TODO paginate this query
    const instances = (await loadProjectInstances(API_GROUP, API_VERSION, PLURAL)) as CustomResource<Workspace.Spec, Workspace.Status>[];

    for (const instance of instances) {
        await collectWorkloadMetrics(instance);
    }
}

export async function collectClusterMetrics() {
    await collectCustomExtensionsMetrics();
}
