import { CustomResource, Workspace } from '@demeter-run/workloads-types';
import { loadProjectInstances } from '../shared';
import { API_GROUP, API_VERSION, PLURAL } from './constants';
import { deleteResource, patchResource, patchResourceStatus } from './handlers';

const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

const EXPIRE_VALUE = process.env.EXPIRE_WORKSPACE_DAYS
    ? Number(process.env.EXPIRE_WORKSPACE_DAYS) * 24 * 60 * 60 * 1000
    : FOURTEEN_DAYS;

const DELETE_EXPIRED_WORKSPACES = process.env.DELETE_EXPIRED_WORKSPACES || 'false';

function checkStatus(item: CustomResource<Workspace.Spec, Workspace.Status>, now: number, expire: number): 'active' | 'expired' {
    if (item.spec.pinned) return 'active';
    if (now - item.status.lastUpdated > expire) return 'expired';
    if (now - item.status.startTime > expire) return 'expired';
    return 'active';
}

export async function checkWorkspaceExpired(): Promise<void> {
    const wks = (await loadProjectInstances(API_GROUP, API_VERSION, PLURAL)) as CustomResource<Workspace.Spec, Workspace.Status>[];
    const filtered = wks.filter(item => item.status.runningStatus !== 'running' && item.status.runningStatus !== 'expired');
    for await (const item of filtered) {
        const now = Date.now();
        const status = checkStatus(item, now, EXPIRE_VALUE);
        if (status === 'expired') {
            console.info({
                message: `Workspace: ${item.metadata?.name}@${item.metadata?.namespace} is expired.`,
            });
            await patchResourceStatus(item.metadata?.namespace!, item.metadata?.name!, { runningStatus: 'expired', storageDCUPerMin: 0 });
            if (DELETE_EXPIRED_WORKSPACES === 'true') {
                console.log('should be deleting workspace, but it is not', item.metadata?.namespace, item.metadata?.name);
                // await deleteResource(item.metadata?.namespace!, item.metadata?.name!);
            }
        }
    }
}
