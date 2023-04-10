import { V1StatefulSet, V1PersistentVolumeClaim, PatchUtils, V1Pod, V1Container, V1EnvVar, V1Volume, V1VolumeMount } from '@kubernetes/client-node';
import { getClients, slugToNamespace, readProjectUnsecure, Network, namespaceToSlug } from '@demeter-sdk/framework';
import { API_VERSION, API_GROUP, PLURAL, SINGULAR, KIND } from './constants';
import { CustomResource, CustomResourceResponse, BackendWithStorage, Pod, StorageClass } from '@demeter-run/workloads-types';
import { buildEnvVars, getDependenciesForNetwork, isCardanoNodeEnabled } from '../shared/dependencies';
import * as nodes from '@demeter-features/cardano-nodes';
import { getComputeDCUPerMin, getNetworkFromAnnotations, getResourcesFromComputeClass, getStorageDcuPerMin, getSTSStatus, listStorage, listStorageWithUsage, loadPods } from '../shared';

export async function handleResource(ns: string, name: string, spec: BackendWithStorage.Spec, owner: CustomResource<BackendWithStorage.Spec, BackendWithStorage.Status>): Promise<void> {
    const { apps } = getClients();

    const project = await readProjectUnsecure(namespaceToSlug(owner.metadata?.namespace!));

    if (!project) {
        throw 'Invalid Project';
    }

    const network = getNetworkFromAnnotations(spec.annotations) as Network;
    const deps = await getDependenciesForNetwork(project, network);
    const envVars = await buildEnvVars(deps, network);
    const usesCardanoNode = isCardanoNodeEnabled(deps);
    const volumesList = volumes(usesCardanoNode);
    const containerList = containers(spec, envVars, usesCardanoNode);
    try {
        await apps.readNamespacedStatefulSet(name, ns);
        //@TODO sync 
        await updateResource(ns, name, spec, containerList, volumesList, envVars);
        // await apps.replaceNamespacedStatefulSet(name, ns, sts(name, spec, owner, containerList, volumesList));
    } catch (err: any) {
        console.log(err?.body)
        await apps.createNamespacedStatefulSet(ns, sts(name, spec, owner, containerList, volumesList));
    }
}

export async function updateResource(ns: string, name: string, spec: BackendWithStorage.Spec, containers: V1Container[], volumes: V1Volume[] | undefined, envVars: V1EnvVar[]): Promise<void> {
    const { apps, core } = getClients();
    // containers should be replaced because of we might need to remove socat and replace ENV VARS
    const containersList = [
        {
            op: 'replace',
            path: '/spec/template/spec/containers',
            value: containers
        }
    ];

    await apps.patchNamespacedStatefulSet(name, ns, containersList, undefined, undefined, undefined, undefined, undefined, { headers: { 'content-type': PatchUtils.PATCH_FORMAT_JSON_PATCH } });

    // patch resource
    const patchBody = {
        metadata: {
            labels: {
                ...spec.annotations,
            },
        },
        spec: {
            replicas: spec.enabled ? spec.replicas : 0,
            template: {
                spec: {
                    restartPolicy: 'Always',
                    volumes
                },
            },
        },
    };

    let options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_STRATEGIC_MERGE_PATCH } };
    await apps.patchNamespacedStatefulSet(name, ns, patchBody, undefined, undefined, undefined, undefined, undefined, options);

    const pvcs = await listStorage(ns, name);
    for (const pvc of pvcs) {
        //  patch pvc
        const pvcPatchBody = {
            spec: {
                resources: {
                    requests: {
                        storage: spec.storage.size,
                    },
                },
                storageClassName: spec.storage.class,
            }
        }

        options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
        await core.patchNamespacedPersistentVolumeClaim(pvc.metadata?.name!, ns, pvcPatchBody, undefined, undefined, undefined, undefined, undefined, options);
    }

}

export async function updateResourceStatus(ns: string, name: string, resource: V1StatefulSet): Promise<void> {
    const { crd } = getClients();
    const pods = await loadPods(ns, name);

    const storage = await listStorageWithUsage(ns, name, pods);
    const mainContainer = resource.spec?.template.spec?.containers.find(i => i.name === 'main');

    const availableEnvVars = mainContainer?.env?.map(i => i.name);

    const runningStatus = getSTSStatus(resource.status!, resource.spec?.replicas!);

    let computeDCUPerMin = 0;
    if (runningStatus === 'running') {
        const owner = await loadResource(ns, name);
        computeDCUPerMin = getComputeDCUPerMin(owner.spec.computeClass, resource.spec?.replicas!)
    }
    let storageDCUPerMin = 0;

    if (storage.length) {
        storageDCUPerMin = getStorageDcuPerMin(storage[0].class as StorageClass, Number(storage[0].size.replace('Gi', '')), storage.length)
    }

    const patch = {
        status: {
            availableReplicas: resource.status?.availableReplicas,
            runningStatus,
            storage,
            computeDCUPerMin,
            storageDCUPerMin,
        },
    };

    const options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
    await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, name, patch, undefined, undefined, undefined, options);

    // env vars should not be merged.
    const envPatch = [{
        op: 'replace',
        path: '/status/availableEnvVars',
        value: availableEnvVars,
    }];

    await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, name, envPatch, undefined, undefined, undefined, { headers: { 'content-type': PatchUtils.PATCH_FORMAT_JSON_PATCH } });

}

export async function pvcUpdated(ns: string, name: string, resource: V1PersistentVolumeClaim): Promise<void> {
    const { crd } = getClients();
    const instance = resource.metadata?.labels ? resource.metadata?.labels['demeter.run/instance'] : undefined;

    if (!instance) return;
    const pods = await loadPods(ns, instance);

    const storage = await listStorageWithUsage(ns, instance, pods);

    let storageDCUPerMin = 0;

    if (storage.length) {
        storageDCUPerMin = getStorageDcuPerMin(storage[0].class as StorageClass, Number(storage[0].size.replace('Gi', '')), storage.length)
    }

    const patch = {
        status: {
            storage,
            storageDCUPerMin
        },
    };

    try {
        const options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
        await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, instance, patch, undefined, undefined, undefined, options);
    } catch (err: any) {
        throw err?.body || err;
    }

}

export async function podUpdated(ns: string, name: string, resource: V1Pod): Promise<void> {
    const { crd } = await getClients();
    const main = resource.status?.containerStatuses?.find(item => item.name === 'main');
    if (main && !main.ready && main.restartCount > 1) {
        const patch = {
            status: {
                runningStatus: 'error',
            },
        };
        const owner = resource.metadata?.ownerReferences![0]!;
        const options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
        await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, owner.name, patch, undefined, undefined, undefined, options);
    }
}

export async function listResourcePods(projectSlug: string, instanceId: string) {
    const { core } = getClients();
    const ns = slugToNamespace(projectSlug);

    try {
        const pods = await core.listNamespacedPod(ns, undefined, undefined, undefined, undefined, `demeter.run/instance=${instanceId}`);
        return pods.body.items.map(podToModel);
    } catch (err) {
        return null;
    }
}

export async function deletePVCs(ns: string, name: string): Promise<void> {
    const { core } = getClients();
    // Auto delete of the PVC is still behind an alpha feature gate (StatefulSetAutoDeletePVC).
    // Once it reaches GA, we can rely on k8s for the clean up procedure.
    // In the meantime, we need to manually call the delete step as part of Demeter logic.
    const pvcs = await core.listNamespacedPersistentVolumeClaim(ns, undefined, undefined, undefined, undefined, `demeter.run/instance=${name}`);

    if (pvcs.body.items.length) {
        for (const item of pvcs.body.items) {
            await core.deleteNamespacedPersistentVolumeClaim(item.metadata?.name!, ns);
        }
    }
}

function buildSocatArgs(spec: BackendWithStorage.Spec) {
    const nodePrivateDNS = nodes.defaultNodePrivateDns(getNetworkFromAnnotations(spec.annotations));
    return ['UNIX-LISTEN:/ipc/node.socket,reuseaddr,fork,unlink-early', `TCP-CONNECT:${nodePrivateDNS}:${nodes.N2C_PORT}`]
}

function sts(name: string, spec: BackendWithStorage.Spec, owner: CustomResource<BackendWithStorage.Spec, BackendWithStorage.Status>, containers: V1Container[], volumes: V1Volume[] | undefined): V1StatefulSet {
    return {
        metadata: {
            name,
            labels: {
                'demeter.run/version': owner.apiVersion!.split('/')[1],
                'demeter.run/kind': owner.kind!,
                ...spec.annotations,
            },
            ownerReferences: [
                {
                    apiVersion: owner.apiVersion!,
                    kind: owner.kind!,
                    uid: owner.metadata!.uid!,
                    name,
                },
            ],
        },
        spec: {
            volumeClaimTemplates: [pvc('storage', spec)],
            // Auto delete of the PVC is still behind an alpha feature gate (StatefulSetAutoDeletePVC).
            // Once it reaches GA, we un-comment the following lines and rely on k8s for the clean up procedure.
            // In the meantime, we need to manually call the delete step as part of Demeter logic.
            //persistentVolumeClaimRetentionPolicy: {
            //    whenDeleted: "Delete",
            //    whenScaled: "Retain",
            //},
            replicas: spec.enabled ? spec.replicas : 0,
            selector: {
                matchLabels: {
                    'demeter.run/instance': name,
                },
            },
            serviceName: SINGULAR,
            template: {
                metadata: {
                    name,
                    labels: {
                        'demeter.run/instance': name,
                        'demeter.run/version': owner.apiVersion!.split('/')[1],
                        'demeter.run/kind': owner.kind!,
                    },
                },
                spec: {
                    tolerations: [
                        {
                            key: 'demeter.run/workload',
                            operator: 'Equal',
                            value: 'ephemeral',
                            effect: 'NoSchedule',
                        },
                    ],
                    securityContext: {
                        fsGroup: 1000,
                    },
                    containers,
                    restartPolicy: 'Always',
                    volumes
                },
            },
        },
    };
}

function pvc(name: string, spec: BackendWithStorage.Spec): V1PersistentVolumeClaim {
    return {
        metadata: {
            name,
            labels: {
                'demeter.run/kind': KIND,
                'demeter.run/version': API_VERSION,
            }
        },
        spec: {
            accessModes: ['ReadWriteOnce'],
            resources: {
                requests: {
                    storage: spec.storage.size,
                },
            },
            storageClassName: spec.storage.class,
        },
    };
}

function podToModel(pod: V1Pod): Pod {
    const name = pod.metadata?.name!;
    return {
        name,
        uid: pod.metadata?.uid!,
        status: pod.status?.phase!,
        containers: pod.status?.containerStatuses!,
        startTime: String(pod.status?.startTime!),
    };
}

function containers(spec: BackendWithStorage.Spec, envVars: V1EnvVar[], usesCardanoNode: boolean): V1Container[] {
    const args = spec.args ? spec.args.split(' ') : [];
    const volumeMounts: V1VolumeMount[] = [
        {
            name: 'storage',
            mountPath: '/var/data',
        },
    ]

    if (usesCardanoNode) {
        volumeMounts.push({
            name: 'ipc',
            mountPath: '/ipc',
        })
    }

    const containers: V1Container[] = [
        {
            name: 'main',
            resources: getResourcesFromComputeClass(spec.computeClass),
            image: spec.image,
            imagePullPolicy: 'IfNotPresent',
            volumeMounts,
            args,
            env: [...envVars, ...spec.envVars]
        }
    ];

    if (usesCardanoNode) {
        containers.push(
            {
                name: 'socat',
                image: 'alpine/socat',
                securityContext: {
                    runAsUser: 1000,
                    runAsGroup: 1000,
                },
                args: [...buildSocatArgs(spec)],
                volumeMounts: [
                    {
                        name: 'ipc',
                        mountPath: '/ipc',
                    },
                ],
            }
        )
    }

    return containers;
}

function volumes(usesCardanoNode: boolean): V1Volume[] | undefined {
    if (usesCardanoNode) {
        return [
            {
                name: 'ipc',
                emptyDir: {},
            },
        ]
    }
}

async function loadResource(ns: string, name: string) {
    const { crd } = getClients();
    const res = await crd.getNamespacedCustomObject(API_GROUP, API_VERSION, ns, PLURAL, name) as CustomResourceResponse<BackendWithStorage.Spec, BackendWithStorage.Status>;
    return res.body;
}