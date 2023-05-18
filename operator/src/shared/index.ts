import { CustomResourceListResponse, ResourceRequest, StorageClass, WorkloadPvc, WorkloadStatus } from '@demeter-run/workloads-types';
import { Pod, getClients } from '@demeter-sdk/framework';
import { V1DeploymentStatus, V1PersistentVolumeClaim, V1Pod, V1StatefulSetStatus, V1Volume } from '@kubernetes/client-node';
import * as nodes from '@demeter-features/cardano-nodes';
import fs from 'fs';
import { buildConfigMapName } from './configmap';
import e from 'express';

type ComputeClass = {
    requests: ResourceRequest;
    limits: ResourceRequest;
    dcu: string;
};

const computeClassFile = fs.readFileSync('./config/compute.json', 'utf8');
const computeClasses = JSON.parse(computeClassFile) as Record<string, ComputeClass>;

function filterPodsForPvc(pods: V1Pod[], ns: string, pvcName: string, instanceId: string) {
    const output: V1Pod[] = [];
    for (const pod of pods) {
        for (const vol of pod.spec?.volumes!) {
            if (vol.persistentVolumeClaim?.claimName === pvcName) {
                output.push(pod);
            }
        }
    }
    return output;
}

export async function loadPods(ns: string, instanceId: string) {
    const { core } = getClients();

    const pods = await core.listNamespacedPod(ns, undefined, undefined, undefined, undefined, `demeter.run/instance=${instanceId}`);

    return pods.body.items;
}

export async function listStorage(ns: string, instanceId: string) {
    const { core } = getClients();

    const pvcs = await core.listNamespacedPersistentVolumeClaim(ns, undefined, undefined, undefined, undefined, `demeter.run/instance=${instanceId}`);

    return pvcs.body.items;
}

export async function listStorageWithUsage(ns: string, instanceId: string, pods: V1Pod[]) {
    const { core } = getClients();

    const pvcs = await core.listNamespacedPersistentVolumeClaim(ns, undefined, undefined, undefined, undefined, `demeter.run/instance=${instanceId}`);

    const output: WorkloadPvc[] = [];

    for (const pvc of pvcs.body.items) {
        const filteredPods = filterPodsForPvc(pods, ns, pvc.metadata?.name!, instanceId);
        if (filteredPods.length) {
            const tmp: WorkloadPvc = pvcToModel(pvc, true);
            output.push(tmp);
        } else {
            output.push(pvcToModel(pvc, false));
        }
    }
    return output;
}

function pvcToModel(pvc: V1PersistentVolumeClaim, inUse: boolean): WorkloadPvc {
    return {
        name: pvc.metadata?.name!,
        size: pvc.spec?.resources?.requests!['storage']!,
        class: pvc.spec?.storageClassName!,
        inUse,
    };
}

export type Size = 'nano' | 'small' | 'medium' | 'large';

export const STORAGE_DCU_PER_GB: Record<StorageClass, number> = {
    gp2: Number(process.env.GP3_STORAGE_PER_GB_PER_MIN_DCUS) || 1,
    gp3: Number(process.env.GP3_STORAGE_PER_GB_PER_MIN_DCUS) || 1,
    fast: Number(process.env.FAST_STORAGE_PER_GB_PER_MIN_DCUS) || 2,
};

export function getStorageDcuPerMin(storageClass: StorageClass, size: number, replicas: number) {
    return (STORAGE_DCU_PER_GB[storageClass] || 1) * size * replicas;
}

export function getComputeDCUPerMin(computeClass: string, replicas: number) {
    return computeClass in computeClasses ? Number(computeClasses[computeClass].dcu) * replicas : 0;
}

export function getResourcesFromComputeClass(computeClass: string) {
    if (computeClass in computeClasses) {
        const { requests, limits } = computeClasses[computeClass];
        return { requests, limits };
    }
    return {
        requests: {
            cpu: '100m',
            memory: '500Mi',
        },
        limits: {
            cpu: '1',
            memory: '500Mi',
        },
    };
}

export async function loadProjectInstances<S, T>(apiGroup: string, apiVersion: string, plural: string) {
    const { crd } = getClients();

    const res = (await crd.listClusterCustomObject(apiGroup, apiVersion, plural)) as CustomResourceListResponse<S, T>;

    return res.body.items;
}

export function buildSocatArgs(annotations: Record<string, string>) {
    const nodePrivateDNS = nodes.defaultNodePrivateDns(getNetworkFromAnnotations(annotations));
    return ['UNIX-LISTEN:/ipc/node.socket,reuseaddr,fork,unlink-early', `TCP-CONNECT:${nodePrivateDNS}:${nodes.N2C_PORT}`];
}

export function getNetworkFromAnnotations(annotations: Record<string, string>) {
    if ('cardano.demeter.run/network' in annotations) {
        return annotations['cardano.demeter.run/network'];
    }
    return '';
}

export function podToModel(pod: V1Pod): Pod {
    // console.log(pod.status);
    const name = pod.metadata?.name || '';
    const main = pod.status?.containerStatuses?.find(c => c.name === 'main');
    const status = main?.state?.running ? 'Running' : main?.state?.terminated ? 'Terminated' : main?.state?.waiting ? 'Waiting' : '';
    return {
        name,
        uid: pod.metadata?.uid || '',
        status,
        startTime: pod.status?.startTime ? String(pod.status?.startTime) : '',
        containers: pod.status?.containerStatuses || [],
    };
}

export function getSTSStatus(status: V1StatefulSetStatus, desiredReplicas: number, lastStatus?: WorkloadStatus, pods?: V1Pod[]): WorkloadStatus {
    if (desiredReplicas === 0) return 'paused';
    const { replicas, currentReplicas, updatedReplicas, availableReplicas, readyReplicas } = status;
    const stsPods = pods?.map(podToModel) || [];
    if (stsPods.length) {
        if (stsPods?.every(pod => pod.status === 'Running') && availableReplicas === desiredReplicas) return 'running';
        if (stsPods?.some(pod => pod.status === 'Running')) return 'degraded';
        if (stsPods?.some(pod => pod.status === '') && lastStatus === 'syncing') return 'error';
        if (stsPods?.some(pod => pod.status === 'Waiting')) return 'provisioning';
        if (stsPods?.every(pod => pod.status === 'Terminated')) return 'error';
    } else {
        // for workspaces we are more lax. If we have a pod, we are running
        if (replicas && replicas > 0 && readyReplicas && readyReplicas > 0) return 'running';
        if (replicas === 1 && (readyReplicas === 0 || typeof readyReplicas === 'undefined')) return 'provisioning';
    }
    return 'provisioning';
}

export function getDeploymentStatus(status: V1DeploymentStatus, replicas: number, lastStatus?: WorkloadStatus): WorkloadStatus {
    if (replicas === 0) return 'paused';

    if (lastStatus === 'syncing') return 'provisioning';

    const { availableReplicas, replicas: replicasCount, updatedReplicas, unavailableReplicas } = status;

    if (replicasCount && replicasCount >= replicas && updatedReplicas === replicas) {
        if (availableReplicas) {
            if (replicasCount > replicas && unavailableReplicas && unavailableReplicas > 0) return 'degraded';
            if (availableReplicas === replicas) return 'running';
            if (availableReplicas < replicas) return 'degraded';
        }
        if (unavailableReplicas) {
            if (unavailableReplicas === replicas && lastStatus !== 'provisioning') return 'error';
            if (unavailableReplicas < replicas) return 'degraded';
        }
    }

    return 'provisioning';
}

export function workloadVolumes(name: string, usesCardanoNode: boolean) {
    const output: V1Volume[] = [
        {
            name: 'config',
            configMap: {
                name: buildConfigMapName(name),
            },
        },
    ];
    if (usesCardanoNode) {
        output.push({
            name: 'ipc',
            emptyDir: {},
        });
    }
    return output;
}
