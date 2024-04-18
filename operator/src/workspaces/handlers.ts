import {
    V1StatefulSet,
    V1PersistentVolumeClaim,
    PatchUtils,
    V1Container,
    V1EnvVar,
    V1Volume,
    V1VolumeMount,
    V1Ingress,
    V1Service,
} from '@kubernetes/client-node';
import { getClients, readProjectUnsecure, Network, namespaceToSlug, DependencySpec, ServicePlugin, DependencyResource } from '@demeter-sdk/framework';
import { API_VERSION, API_GROUP, PLURAL, SINGULAR, KIND, DEFAULT_VSCODE_IMAGE } from './constants';
import { CustomResource, Workspace, StorageClass, CustomResourceResponse } from '@demeter-run/workloads-types';
import { buildEnvVars, cardanoNodeDep, getDependenciesForNetwork, isCardanoNodeEnabled } from '../shared/dependencies';
import {
    getComputeDCUPerMin,
    getNetworkFromAnnotations,
    getResourcesFromComputeClass,
    getStorageDcuPerMin,
    getSTSStatus,
    listStorage,
    listStorageWithUsage,
    loadPods,
} from '../shared';
import { buildDefaultEnvVars, buildDnsZone, INITIAL_ENV_VAR_NAMES } from './helpers';
import { buildSocatContainer } from '../shared/cardano-node-helper';
import { buildPortEnvVars } from '../shared/ports';

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
    spec: Workspace.Spec,
    owner: CustomResource<Workspace.Spec, Workspace.Status>,
): Promise<void> {
    const { apps, core, net } = getClients();

    const project = await readProjectUnsecure(namespaceToSlug(owner.metadata?.namespace!));

    if (!project) {
        throw 'Invalid Project';
    }

    const network = getNetworkFromAnnotations(spec.annotations) as Network;
    const deps = await getDependenciesForNetwork(project, network);
    const depsEnvVars = await buildEnvVars(deps, network);
    const portEnvVars = await buildPortEnvVars(project, network);
    const defaultEnvVars = buildDefaultEnvVars(spec);
    const cardanoNode = cardanoNodeDep(deps);
    const envVars = [...depsEnvVars, ...defaultEnvVars, ...portEnvVars];
    const volumesList = volumes(!!cardanoNode);
    const containerList = containers(spec, envVars, cardanoNode);
    try {
        await apps.readNamespacedStatefulSet(name, ns);
        await updateResource(ns, name, spec, containerList, volumesList, owner);
        await handleIngress(ns, name, spec, owner);
    } catch (err: any) {
        console.log(err?.body);
        await apps.createNamespacedStatefulSet(ns, sts(name, spec, owner, containerList, volumesList));
        await core.createNamespacedService(ns, service(name, owner));
        await net.createNamespacedIngress(ns, ingress(name, buildDnsZone(spec), owner));
    }
}

async function handleIngress(ns: string, name: string, spec: Workspace.Spec, owner: CustomResource<Workspace.Spec, Workspace.Status>) {
    const { net } = getClients();

    const exists = await net.readNamespacedIngress(name, ns).catch(() => false);

    if (spec.enabled && !exists) {
        console.log('Creating ingress for workspace', name);
        await net
            .createNamespacedIngress(ns, ingress(name, buildDnsZone(spec), owner))
            .catch((err: any) => console.log('Error creating ingress for workspace', name, err.body));
    }

    if (!spec.enabled && exists) {
        console.log('Deleting ingress for workspace', name);
        await net.deleteNamespacedIngress(name, ns).catch(() => console.log('Error deleting ingress for workspace', name));
    }
}

export async function updateResource(
    ns: string,
    name: string,
    spec: Workspace.Spec,
    containers: V1Container[],
    volumes: V1Volume[] | undefined,
    owner: CustomResource<Workspace.Spec, Workspace.Status>,
): Promise<void> {
    const { apps, core } = getClients();

    // patch resource
    const patchBody = {
        metadata: {
            labels: {
                'demeter.run/version': owner.apiVersion!.split('/')[1],
                'demeter.run/kind': owner.kind!,
            },
            annotations: {
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
                    automountServiceAccountToken: false,
                    volumes,
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
    const mainContainer = resource.spec?.template.spec?.containers?.find(i => i.name === 'main');

    const availableEnvVars = mainContainer?.env?.map(i => i.name).filter(i => !INITIAL_ENV_VAR_NAMES.includes(i));

    const owner = await loadResource(ns, name);

    const runningStatus = getSTSStatus(resource.status!, resource.spec?.replicas!, owner.status.runningStatus);
    
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
        {
            op: 'replace',
            path: '/status/lastUpdated',
            value: Date.now(),
        },
    ];

    await crd.patchNamespacedCustomObjectStatus(API_GROUP, API_VERSION, ns, PLURAL, name, patch, undefined, undefined, undefined, {
        headers: { 'content-type': PatchUtils.PATCH_FORMAT_JSON_PATCH },
    });
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
    await crd.patchNamespacedCustomObjectStatus(
        API_GROUP,
        API_VERSION,
        item.metadata?.namespace!,
        PLURAL,
        item.metadata?.name!,
        patch,
        undefined,
        undefined,
        undefined,
        options,
    );
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
    spec: Workspace.Spec,
    owner: CustomResource<Workspace.Spec, Workspace.Status>,
    containers: V1Container[],
    volumes: V1Volume[] | undefined,
): V1StatefulSet {
    return {
        metadata: {
            name,
            labels: {
                'demeter.run/version': owner.apiVersion!.split('/')[1],
                'demeter.run/kind': owner.kind!,
            },
            annotations: {
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
                    automountServiceAccountToken: false,
                    tolerations,
                    securityContext: {
                        fsGroup: 1000,
                    },
                    containers: {
                        ...containers,
                    },
                    restartPolicy: 'Always',
                    volumes,
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

function getImageFromSpec(spec: Workspace.Spec): string {
    if (spec.ide.image) return spec.ide.image;
    switch (spec.ide.type) {
        case 'openvscode':
            return DEFAULT_VSCODE_IMAGE;
    }
}

function containers(
    spec: Workspace.Spec,
    envVars: V1EnvVar[],
    cardanoNodeDep: { dependency: DependencyResource; service: ServicePlugin } | null,
    patch?: boolean,
): V1Container[] {
    const volumeMounts: V1VolumeMount[] = [
        {
            name: 'home',
            mountPath: '/config',
        },
    ];

    if (!!cardanoNodeDep) {
        volumeMounts.push({
            name: 'ipc',
            mountPath: '/ipc',
        });
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
        },
    ];

    if (!!cardanoNodeDep) {
        containers.push(buildSocatContainer(cardanoNodeDep.dependency, cardanoNodeDep.service));
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
        ];
    }
}

function ingress(name: string, clusterDnsZone: string[], owner: CustomResource<Workspace.Spec, Workspace.Status>): V1Ingress {
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
            ingressClassName: process.env.INGRESS_CLASS || 'nginx',
            rules: clusterDnsZone.map(dns => ({
                host: `wks-${name}.${dns}`,
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
            })),
            tls: [
                {
                    hosts: clusterDnsZone.map(dns => `*.${dns}`),
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
    const res = await crd.patchNamespacedCustomObject(API_GROUP, API_VERSION, ns, PLURAL, name, patch, undefined, undefined, undefined, options);
    return res.body as CustomResource<Workspace.Spec, Workspace.Status>;
}

export async function patchResourceStatus(ns: string, name: string, status: Partial<Workspace.Status>) {
    const { crd } = getClients();

    const patch = {
        status,
    };

    const options = { headers: { 'Content-type': PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH } };
    const res = await crd.patchNamespacedCustomObjectStatus(
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
    const res = (await crd.getNamespacedCustomObject(API_GROUP, API_VERSION, ns, PLURAL, name)) as CustomResourceResponse<
        Workspace.Spec,
        Workspace.Status
    >;
    return res.body;
}

export async function deleteResource(ns: string, name: string) {
    const { crd } = getClients();

    await crd.deleteNamespacedCustomObject(API_GROUP, API_VERSION, ns, PLURAL, name);
    return null;
}
