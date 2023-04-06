import { V1StatefulSet, V1PersistentVolumeClaim, PatchUtils, V1Pod, V1Container, V1EnvVar, V1Volume, V1VolumeMount, V1Ingress, V1Service } from '@kubernetes/client-node';
import { getClients, slugToNamespace, readProjectUnsecure, Network, namespaceToSlug } from '@demeter-sdk/framework';
import { API_VERSION, API_GROUP, PLURAL, SINGULAR, KIND, DEFAULT_VSCODE_IMAGE } from './constants';
import { CustomResource, CustomResourceListResponse, Workspace, StorageClass, Pod, ResourceRequest, CustomResourceResponse } from '@demeter-run/workloads-types';
import { buildEnvVars, getDependenciesForNetwork, isCardanoNodeEnabled } from '../shared/dependencies';
import { buildSocatArgs, getComputeDCUPerMin, getNetworkFromAnnotations, getResourcesFromComputeClass, getStorageDcuPerMin, getSTSStatus, listStorage, listStorageWithUsage, loadPods, Size } from '../shared';
import { buildDefaultEnvVars, buildDnsZone, INITIAL_ENV_VAR_NAMES } from './helpers';

export async function handleResource(ns: string, name: string, spec: Workspace.Spec, owner: CustomResource<Workspace.Spec, Workspace.Status>): Promise<void> {
    const { apps, core, net } = getClients();

    const project = await readProjectUnsecure(namespaceToSlug(owner.metadata?.namespace!));

    if (!project) {
        throw 'Invalid Project';
    }

    const network = getNetworkFromAnnotations(spec.annotations) as Network;
    const deps = await getDependenciesForNetwork(project, network);
    const depsEnvVars = await buildEnvVars(deps, network);
    const defaultEnvVars = buildDefaultEnvVars(spec);
    const usesCardanoNode = isCardanoNodeEnabled(deps);
    const envVars = [...depsEnvVars, ...defaultEnvVars]
    const volumesList = volumes(usesCardanoNode);
    const containerList = containers(spec, envVars, usesCardanoNode);
    try {
        await apps.readNamespacedStatefulSet(name, ns);
        await updateResource(ns, name, spec, containerList, volumesList, owner);
    } catch (err: any) {
        console.log(err?.body)
        await apps.createNamespacedStatefulSet(ns, sts(name, spec, owner, containerList, volumesList));
        await core.createNamespacedService(ns, service(name, owner));
        await net.createNamespacedIngress(ns, ingress(name, buildDnsZone(spec), owner));
    }
}

export async function updateResource(ns: string, name: string, spec: Workspace.Spec, containers: V1Container[], volumes: V1Volume[] | undefined, owner: CustomResource<Workspace.Spec, Workspace.Status>): Promise<void> {
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
                'demeter.run/version': owner.apiVersion!.split('/')[1],
                'demeter.run/kind': owner.kind!,
                ...spec.annotations,
            },
            // needed for migration from old wks
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
            replicas: spec.enabled ? 1 : 0,
            template: {
                metadata: {
                    labels: {
                        'demeter.run/version': owner.apiVersion!.split('/')[1],
                        'demeter.run/kind': owner.kind!,
                    },
                },
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
            metadata: {
                labels: {
                    'demeter.run/kind': KIND,
                    'demeter.run/version': API_VERSION,
                },
            },
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

    const availableEnvVars = mainContainer?.env?.map(i => i.name).filter(i => !INITIAL_ENV_VAR_NAMES.includes(i));

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

export async function updateResourceLastActivity(item: CustomResource<Workspace.Spec, Workspace.Status>, lastActivity: number) {
    const { crd } = getClients();

    const patch = {
        status: {
            lastSeen: lastActivity,
            lastUpdated: Date.now(),
        },
    };
    const options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
    await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, item.metadata?.namespace!, PLURAL, item.metadata?.name!, patch, undefined, undefined, undefined, options);

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

function sts(name: string, spec: Workspace.Spec, owner: CustomResource<Workspace.Spec, Workspace.Status>, containers: V1Container[], volumes: V1Volume[] | undefined): V1StatefulSet {
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
            volumeClaimTemplates: [pvc('home', spec)],
            // Auto delete of the PVC is still behind an alpha feature gate (StatefulSetAutoDeletePVC).
            // Once it reaches GA, we un-comment the following lines and rely on k8s for the clean up procedure.
            // In the meantime, we need to manually call the delete step as part of Demeter logic.
            //persistentVolumeClaimRetentionPolicy: {
            //    whenDeleted: "Delete",
            //    whenScaled: "Retain",
            //},
            replicas: spec.enabled ? 1 : 0,
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

function pvc(name: string, spec: Workspace.Spec): V1PersistentVolumeClaim {
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

function getImageFromSpec(spec: Workspace.Spec): string {
    if (spec.ide.image) return spec.ide.image;
    switch (spec.ide.type) {
        case 'openvscode':
            return DEFAULT_VSCODE_IMAGE;
    }
}

function containers(spec: Workspace.Spec, envVars: V1EnvVar[], usesCardanoNode: boolean): V1Container[] {
    const volumeMounts: V1VolumeMount[] = [
        {
            name: 'home',
            mountPath: '/config',
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
            ports: [{ containerPort: 8443, name: 'webui' }],
            resources: getResourcesFromComputeClass(spec.computeClass),
            image: getImageFromSpec(spec),
            imagePullPolicy: 'Always',
            volumeMounts,
            env: envVars,
            readinessProbe: {
                tcpSocket: {
                    port: 8443,
                },
                initialDelaySeconds: 20,
                failureThreshold: 20,
                periodSeconds: 10,
            },
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
                args: [...buildSocatArgs(spec.annotations)],
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

function ingress(name: string, clusterDnsZone: string, owner: CustomResource<Workspace.Spec, Workspace.Status>): V1Ingress {
    return {
        metadata: {
            name,
            labels: {
                'demeter.run/instance': name,
            },
            annotations: {
                'cert-manager.io/cluster-issuer': 'letsencrypt',
                'nginx.ingress.kubernetes.io/proxy-read-timeout': '3600',
                'nginx.ingress.kubernetes.io/proxy-send-timeout': '3600',
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
            ingressClassName: 'nginx',
            rules: [
                {
                    host: `wks-${name}.${clusterDnsZone}`,
                    http: {
                        paths: [
                            {
                                pathType: 'Prefix',
                                path: '/',
                                backend: {
                                    service: {
                                        name,
                                        port: {
                                            number: 3000,
                                        },
                                    },
                                },
                            },
                        ],
                    },
                },
            ],
            tls: [
                {
                    hosts: [`*.${clusterDnsZone}`],
                },
            ],
        },
    };
}

function service(name: string, owner: CustomResource<Workspace.Spec, Workspace.Status>): V1Service {
    return {
        metadata: {
            name,
            labels: {
                'demeter.run/instance': name,
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
            ports: [
                {
                    name: 'webui',
                    port: 3000,
                    targetPort: 8443,
                    protocol: 'TCP',
                },
            ],
            type: 'ClusterIP',
            selector: {
                'demeter.run/instance': name,
            },
        },
    };
}



export async function patchResource(ns: string, name: string, spec: Partial<Workspace.Spec>) {
    const { crd } = getClients();

    const patch = {
        spec,
    };

    const options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
    const res = await crd.patchNamespacedCustomObject(
        API_GROUP,
        API_VERSION,
        ns,
        PLURAL,
        name,
        patch,
        undefined,
        undefined,
        undefined,
        options,
    );
    return res.body as CustomResource<Workspace.Spec, Workspace.Status>;
}

async function loadResource(ns: string, name: string) {
    const { crd } = getClients();
    const res = await crd.getNamespacedCustomObject(API_GROUP, API_VERSION, ns, PLURAL, name) as CustomResourceResponse<Workspace.Spec, Workspace.Status>;
    return res.body;
}