import { CustomResource, Workspace } from '@demeter-run/workloads-types';
import { loadProjectInstances } from '../shared';
import { API_GROUP, API_VERSION, PLURAL } from './constants';
import { patchResource } from './handlers';

const IDLE_VALUE = process.env.IDLE_WORKSPACE_S ? Number(process.env.IDLE_WORKSPACE_S) * 1000 : 1800;
const PAUSE_IDLE_WORKSPACES = process.env.PAUSE_IDLE_WORKSPACES || 'true';


function checkStatus(item: CustomResource<Workspace.Spec, Workspace.Status>, now: number, expire: number): 'active' | 'expired' | 'unknown' {
    if (!item.status.lastSeen) return 'unknown';
    // check instant time is fresh. else return active, we don't have data
    if (now - item.status.lastUpdated > 20 * 1000) {
        return 'active';
    }

    if (item.status.lastSeen === 0) return 'unknown';

    if (item.status.lastSeen * 1000 < now - expire) return 'expired';
    return 'active';

}

function checkUnknown(item: CustomResource<Workspace.Spec, Workspace.Status>, now: number, expire: number): 'active' | 'expired' {
    if (!item.status.startTime) return 'active';
    if (now - item.status.lastUpdated > 20 * 1000) return 'active';
    if (now - item.status.startTime > expire) return 'expired';
    return 'active';
}

export function checkWorkspaceActiveStatus(
    item: CustomResource<Workspace.Spec, Workspace.Status>,
    now: number,
    expire: number,
): 'active' | 'expired' {
    let status = checkStatus(item, now, expire);
    if (status === 'unknown') {
        status = checkUnknown(item, now, expire);
    }
    return status;
}



export async function checkWorkspaceIdle(): Promise<void> {
    const wks = await loadProjectInstances(API_GROUP, API_VERSION, PLURAL) as CustomResource<Workspace.Spec, Workspace.Status>[];
    const running = wks.filter(item => item.status.runningStatus === 'running');
    for await (const item of running) {
        const now = Date.now();
        const status = checkWorkspaceActiveStatus(item, now, IDLE_VALUE);
        if (status === 'expired') {
            console.info({
                message: `Workspace: ${item.metadata?.name}@${item.metadata?.namespace} is expired.`,
            });
            if (PAUSE_IDLE_WORKSPACES === 'true') {
                console.log('pausing workspace', item.metadata?.namespace, item.metadata?.name);
                await patchResource(item.metadata?.namespace!, item.metadata?.name!, { enabled: false })
            }
        }
    }
}
