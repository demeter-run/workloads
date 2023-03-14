import { StorageClass, WorkloadPvc } from "@demeter-run/workloads-types";
import { getClients } from "@demeter-sdk/framework";
import { V1PersistentVolumeClaim, V1Pod } from "@kubernetes/client-node";

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
  }
}

export type Size = 'nano' | 'small' | 'medium' | 'large';

export const COMPUTE_DCU: Record<Size, number> = {
  nano: Number(process.env.NANO_COMPUTE_PER_MIN_DCUS) || 154,
  small: Number(process.env.SMALL_COMPUTE_PER_MIN_DCUS) || 308,
  medium: Number(process.env.MEDIUM_COMPUTE_PER_MIN_DCUS) || 729,
  large: Number(process.env.LARGE_COMPUTE_PER_MIN_DCUS) || 1458
}

export const STORAGE_DCU_PER_GB: Record<StorageClass, number> = {
  gp3: Number(process.env.GP3_STORAGE_PER_GB_PER_MIN_DCUS) || 8,
  fast: Number(process.env.FAST_STORAGE_PER_GB_PER_MIN_DCUS) || 16,
}

export function getStorageDcuPerMin(storageClass: StorageClass, size: number, replicas: number) {
  return STORAGE_DCU_PER_GB[storageClass] * size * replicas;
}

export function getComputeDCUPerMin(size: Size, replicas: number) {
  return COMPUTE_DCU[size] * replicas;
}