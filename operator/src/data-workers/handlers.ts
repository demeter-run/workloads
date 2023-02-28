import { V1StatefulSet, V1StatefulSetStatus, V1PersistentVolumeClaim, PatchUtils, V1Pod, V1Container, V1EnvVar, V1Volume, V1VolumeMount } from '@kubernetes/client-node';
import { getClients, slugToNamespace, readProjectUnsecure, Network, namespaceToSlug } from '@demeter-sdk/framework';
import { Pod } from './model';
import { API_VERSION, API_GROUP, PLURAL, SINGULAR, KIND } from './constants';
import { CustomResource, CustomResourceListResponse, DataWorker } from '@demeter-run/workloads-types';
import { buildEnvVars, getDependenciesForNetwork, getNetworkFromAnnotations, isCardanoNodeEnabled } from './dependencies';
import * as nodes from '@demeter-features/cardano-nodes';

const DNS_ZONE = process.env.DNS_ZONE;
const CLUSTER_NAME = process.env.CLUSTER_NAME;

export const clusterDnsZone = `${CLUSTER_NAME}.${DNS_ZONE}`;

function buildPVCName(name: string) {
    return `db-${name}-0`;
}

type Status = 'running' | 'paused' | 'provisioning';

export function getSTSStatus(status: V1StatefulSetStatus): Status {
    if (status.replicas === 0 || !status.updatedReplicas) return 'paused';
    if (status.replicas && status.replicas > 0 && status.readyReplicas && status.readyReplicas > 0) return 'running';
    if (status.replicas === 1 && (status.readyReplicas === 0 || typeof status.readyReplicas === 'undefined')) return 'provisioning';
    return 'paused';
}

export async function listResources(ns: string) {
    const { crd } = getClients();

    const res = (await crd.listNamespacedCustomObject(
        API_GROUP,
        API_VERSION,
        ns,
        PLURAL,
    )) as CustomResourceListResponse<DataWorker.Spec, DataWorker.Status>;

    return res.body.items;
}

export async function listResourceForAllNamespaces() {
    const { crd } = getClients();

    const res = (await crd.listClusterCustomObject(
        API_GROUP,
        API_VERSION,
        PLURAL,
    )) as CustomResourceListResponse<DataWorker.Spec, DataWorker.Status>;
    return res.body.items;

}

export async function handleResource(ns: string, name: string, spec: DataWorker.Spec, owner: CustomResource<DataWorker.Spec, DataWorker.Status>): Promise<void> {
    const { apps } = getClients();

    const project = await readProjectUnsecure(namespaceToSlug(owner.metadata?.namespace!));

    if (!project) {
        throw 'Invalid Project';
    }

    const network = getNetworkFromAnnotations(spec.annotations) as Network;
    const deps = await getDependenciesForNetwork(project, network);
    const envVars = await buildEnvVars(deps, network);
    const usesCardanoNode = isCardanoNodeEnabled(deps);
    const containerList = containers(spec, envVars, usesCardanoNode);
    const volumesList = volumes(usesCardanoNode);
    const existing = await apps.readNamespacedStatefulSet(name, ns);
    if (existing?.body) {
        await apps.replaceNamespacedStatefulSet(name, ns, sts(name, spec, owner, containerList, volumesList));
    } else {
        await apps.createNamespacedStatefulSet(ns, sts(name, spec, owner, containerList, volumesList));
    }

}

export async function updateResource(ns: string, name: string, spec: DataWorker.Spec): Promise<void> {
    // const { apps, core } = getClients();

    // // patch resource
    // const mainArgs = buildArgs(spec);
    // const socatArgs = buildSocatArgs(spec);
    // const patchBody = {
    //     metadata: {
    //         labels: {
    //             'cardano.demeter.run/network': spec.network,
    //         }
    //     },
    //     spec: {
    //         template: {
    //             spec: {
    //                 containers: [{
    //                     name: 'main',
    //                     args: mainArgs,
    //                     resources: spec.resources,
    //                     image: spec.image

    //                 },
    //                 {
    //                     name: 'socat',
    //                     args: socatArgs,
    //                 }]
    //             }
    //         },
    //         replicas: spec.enabled ? spec.replicas : 0,
    //     }
    // }
    // let options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_STRATEGIC_MERGE_PATCH } };
    // await apps.patchNamespacedStatefulSet(name, ns, patchBody, undefined, undefined, undefined, undefined, undefined, options);

    // // patch pvc
    // const pvcPatchBody = {
    //     spec: {
    //         resources: {
    //             requests: {
    //                 storage: spec.storage.size,
    //             },
    //         },
    //         storageClassName: spec.storage.class,
    //     }
    // }

    // options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
    // await core.patchNamespacedPersistentVolumeClaim(buildPVCName(name), ns, pvcPatchBody, undefined, undefined, undefined, undefined, undefined, options);
}

export async function updateResourceStatus(ns: string, name: string, resource: V1StatefulSet): Promise<void> {
    const { crd } = getClients();

    const patch = {
        status: {
            availableReplicas: resource.status?.availableReplicas,
            runningStatus: getSTSStatus(resource.status!),
        },
    };

    const options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
    await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, name, patch, undefined, undefined, undefined, options);
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

export async function deletePVC(ns: string, name: string): Promise<void> {
    const { core } = getClients();
    // Auto delete of the PVC is still behind an alpha feature gate (StatefulSetAutoDeletePVC).
    // Once it reaches GA, we can rely on k8s for the clean up procedure.
    // In the meantime, we need to manually call the delete step as part of Demeter logic.
    await core.deleteNamespacedPersistentVolumeClaim(buildPVCName(name), ns);
}

function buildSocatArgs(spec: DataWorker.Spec) {
    const nodePrivateDNS = nodes.defaultNodePrivateDns(getNetworkFromAnnotations(spec.annotations));
    return ['UNIX-LISTEN:/ipc/node.socket,reuseaddr,fork,unlink-early', `TCP-CONNECT:${nodePrivateDNS}:${nodes.N2C_PORT}`]
}

function sts(name: string, spec: DataWorker.Spec, owner: CustomResource<DataWorker.Spec, DataWorker.Status>, containers: V1Container[], volumes: V1Volume[] | undefined): V1StatefulSet {
    return {
        metadata: {
            name,
            labels: {
                'demeter.run/version': owner.apiVersion!.split('/')[1],
                'demeter.run/kind': owner.kind!,
                'demeter.run/tenancy': spec.tenancy,
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

function pvc(name: string, spec: DataWorker.Spec): V1PersistentVolumeClaim {
    return {
        metadata: {
            name,
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

function containers(spec: DataWorker.Spec, envVars: V1EnvVar[], usesCardanoNode: boolean): V1Container[] {
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
            resources: spec.resources,
            image: spec.image,
            imagePullPolicy: 'IfNotPresent',
            volumeMounts,
            args,
            env: envVars
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
