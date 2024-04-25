import { V1StatefulSet, V1PersistentVolumeClaim, PatchUtils, V1Container, V1EnvVar, V1Volume, V1VolumeMount } from '@kubernetes/client-node';
import { getClients, readProjectUnsecure, Network, namespaceToSlug, DependencyResource, ServicePlugin } from '@demeter-sdk/framework';
import { API_VERSION, API_GROUP, PLURAL, SINGULAR, KIND } from './constants';
import { CustomResource, CustomResourceResponse, BackendWithStorage, StorageClass } from '@demeter-run/workloads-types';
import { buildEnvVars, cardanoNodeDep, cardanoNodePort, getDependenciesForNetwork, isCardanoNodeEnabled } from '../shared/dependencies';
import {
    getComputeDCUPerMin,
    getNetworkFromAnnotations,
    getResourcesFromComputeClass,
    getStorageDcuPerMin,
    getSTSStatus,
    listStorage,
    listStorageWithUsage,
    loadPods,
    workloadVolumes,
} from '../shared';
import { checkConfigMapExistsOrCreate, configmap } from '../shared/configmap';
import { buildSocatContainer, buildSocatContainerForPort } from '../shared/cardano-node-helper';
import { buildPortEnvVars, getPortsForNetwork } from '../shared/ports';
import { ServiceInstanceWithStatusAndKind } from '../services';

const tolerations = [
    {
        effect: 'NoSchedule',
        key: 'demeter.run/compute-profile',
        operator: 'Equal',
        value: 'general-purpose',
    },
    {
        effect: 'NoSchedule',
        key: 'demeter.run/compute-arch',
        operator: 'Equal',
        value: 'x86',
    },
    {
        effect: 'NoSchedule',
        key: 'demeter.run/availability-sla',
        operator: 'Equal',
        value: 'best-effort',
    },
];


export async function handleResource(
    ns: string,
    name: string,
    spec: BackendWithStorage.Spec,
    owner: CustomResource<BackendWithStorage.Spec, BackendWithStorage.Status>,
): Promise<void> {
    const { apps, core } = getClients();

    const project = await readProjectUnsecure(namespaceToSlug(owner.metadata?.namespace!));

    if (!project) {
        throw 'Invalid Project';
    }

    const network = getNetworkFromAnnotations(spec.annotations) as Network;
    const deps = await getDependenciesForNetwork(project, network);
    const ports = await getPortsForNetwork(project, network);
    const portEnvVars = await buildPortEnvVars(ports);
    const depsEnvVars = await buildEnvVars(deps, network);
    const envVars = [...depsEnvVars, ...portEnvVars];
    const cardanoNode = cardanoNodeDep(deps);
    const cardanoNodePortInstance = cardanoNodePort(ports);
    const volumesList = workloadVolumes(name, !!cardanoNode);
    const containerList = containers(spec, envVars, cardanoNode, cardanoNodePortInstance);
    try {
        await apps.readNamespacedStatefulSet(name, ns);
        //@TODO sync
        await checkConfigMapExistsOrCreate(core, ns, name, spec, owner);
        await updateResource(ns, name, spec, containerList, volumesList);
        // await apps.replaceNamespacedStatefulSet(name, ns, sts(name, spec, owner, containerList, volumesList));
    } catch (err: any) {
        console.log(err?.body);
        await core.createNamespacedConfigMap(ns, configmap(name, spec, owner)).catch(err => console.log('configmap already exists'));
        await apps.createNamespacedStatefulSet(ns, sts(name, spec, owner, containerList, volumesList));
    }
}

export async function updateResource(
    ns: string,
    name: string,
    spec: BackendWithStorage.Spec,
    containers: V1Container[],
    volumes: V1Volume[],
): Promise<void> {
    const { apps, core } = getClients();

    // patch resource
    const patchBody = {
        metadata: {
            annotations: {
                ...spec.annotations,
            },
        },
        spec: {
            replicas: spec.enabled ? spec.replicas : 0,
            template: {
                spec: {
                    automountServiceAccountToken: false,
                    volumes: [
                        ...volumes,
                        {
                            $patch: 'replace',
                        },
                    ],
                    containers: [
                        ...containers,
                        {
                            $patch: 'replace',
                        },
                    ],
                    tolerations,
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
            },
        };

        options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
        await core.patchNamespacedPersistentVolumeClaim(
            pvc.metadata?.name!,
            ns,
            pvcPatchBody,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            options,
        );
    }
}

export async function updateResourceStatus(ns: string, name: string, resource: V1StatefulSet): Promise<void> {
    const { crd } = getClients();
    const pods = await loadPods(ns, name);

    const storage = await listStorageWithUsage(ns, name, pods);
    const mainContainer = resource.spec?.template.spec?.containers.find(i => i.name === 'main');

    const availableEnvVars = mainContainer?.env?.map(i => i.name);

    const owner = await loadResource(ns, name);

    const runningStatus = getSTSStatus(resource.status!, resource.spec?.replicas!, owner?.status?.runningStatus, pods);

    let computeDCUPerMin = 0;
    if (runningStatus === 'running') {
        computeDCUPerMin = getComputeDCUPerMin(owner.spec.computeClass, resource.spec?.replicas!);
    }
    let storageDCUPerMin = 0;

    if (storage.length) {
        storageDCUPerMin = getStorageDcuPerMin(storage[0].class as StorageClass, Number(storage[0].size.replace('Gi', '')), storage.length);
    }

    const patch = [
        {
            op: 'replace',
            path: '/status/availableReplicas',
            value: resource.status?.availableReplicas || 0,
        },
        {
            op: 'replace',
            path: '/status/runningStatus',
            value: runningStatus,
        },
        {
            op: 'replace',
            path: '/status/computeDCUPerMin',
            value: computeDCUPerMin,
        },
        {
            op: 'replace',
            path: '/status/storage',
            value: storage,
        },
        {
            op: 'replace',
            path: '/status/storageDCUPerMin',
            value: storageDCUPerMin,
        },
        {
            op: 'replace',
            path: '/status/availableEnvVars',
            value: availableEnvVars,
        },
    ];

    await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, name, patch, undefined, undefined, undefined, {
        headers: { 'content-type': PatchUtils.PATCH_FORMAT_JSON_PATCH },
    });
}

export async function pvcUpdated(ns: string, name: string, resource: V1PersistentVolumeClaim): Promise<void> {
    const { crd } = getClients();
    const instance = resource.metadata?.labels ? resource.metadata?.labels['demeter.run/instance'] : undefined;

    if (!instance) return;
    const pods = await loadPods(ns, instance);

    const storage = await listStorageWithUsage(ns, instance, pods);

    let storageDCUPerMin = 0;

    if (storage.length) {
        storageDCUPerMin = getStorageDcuPerMin(storage[0].class as StorageClass, Number(storage[0].size.replace('Gi', '')), storage.length);
    }

    const patch = {
        status: {
            storage,
            storageDCUPerMin,
        },
    };

    try {
        const options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
        await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, instance, patch, undefined, undefined, undefined, options);
    } catch (err: any) {
        throw err?.body || err;
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

function sts(
    name: string,
    spec: BackendWithStorage.Spec,
    owner: CustomResource<BackendWithStorage.Spec, BackendWithStorage.Status>,
    containers: V1Container[],
    volumes: V1Volume[],
): V1StatefulSet {
    return {
        metadata: {
            name,
            labels: {
                'demeter.run/version': owner.apiVersion!.split('/')[1],
                'demeter.run/kind': owner.kind!,
            },
            annotations: {
                ...spec.annotations
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
            podManagementPolicy: 'Parallel',
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
                    automountServiceAccountToken: false,
                    tolerations,
                    securityContext: {
                        fsGroup: 1000,
                    },
                    containers,
                    restartPolicy: 'Always',
                    volumes,
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
            },
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

function containers(
    spec: BackendWithStorage.Spec,
    envVars: V1EnvVar[],
    cardanoNodeDep: { dependency: DependencyResource; service: ServicePlugin } | null,
    cardanoNodePort: ServiceInstanceWithStatusAndKind | null,
): V1Container[] {
    const args = spec.args ? spec.args.split(' ') : [];
    const command = spec.command ? spec.command.split(' ') : [];

    const volumeMounts: V1VolumeMount[] = [
        {
            name: 'storage',
            mountPath: spec.storage.mountPath || '/var/data',
        },
        {
            name: 'config',
            mountPath: '/etc/config',
        },
    ];

    if (!!cardanoNodePort || !!cardanoNodeDep) {
        volumeMounts.push({
            name: 'ipc',
            mountPath: '/ipc',
        });
    }

    const containers: V1Container[] = [
        {
            name: 'main',
            resources: getResourcesFromComputeClass(spec.computeClass),
            image: spec.image,
            imagePullPolicy: 'IfNotPresent',
            volumeMounts,
            args,
            command,
            env: [...envVars, ...spec.envVars],
        },
    ];

    if (!!cardanoNodePort) {
        containers.push(buildSocatContainerForPort(cardanoNodePort));
    } else if (!!cardanoNodeDep) {
        containers.push(buildSocatContainer(cardanoNodeDep.dependency, cardanoNodeDep.service));
    }

    return containers;
}

async function loadResource(ns: string, name: string) {
    const { crd } = getClients();
    const res = (await crd.getNamespacedCustomObject(API_GROUP, API_VERSION, ns, PLURAL, name)) as CustomResourceResponse<
        BackendWithStorage.Spec,
        BackendWithStorage.Status
    >;
    return res.body;
}
