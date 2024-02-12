import { PatchUtils, V1Container, V1EnvVar, V1Volume, V1VolumeMount, V1Deployment } from '@kubernetes/client-node';
import { getClients, readProjectUnsecure, Network, namespaceToSlug, DependencyResource, ServicePlugin } from '@demeter-sdk/framework';
import { API_VERSION, API_GROUP, PLURAL } from './constants';
import { CustomResource, CustomResourceResponse, Backend, Pod, WorkloadStatus } from '@demeter-run/workloads-types';
import { buildEnvVars, cardanoNodeDep, getDependenciesForNetwork, isCardanoNodeEnabled } from '../shared/dependencies';
import { getComputeDCUPerMin, getDeploymentStatus, getNetworkFromAnnotations, getResourcesFromComputeClass, workloadVolumes } from '../shared';
import { checkConfigMapExistsOrCreate, configmap } from '../shared/configmap';
import { buildSocatContainer } from '../shared/cardano-node-helper';

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
    spec: Backend.Spec,
    owner: CustomResource<Backend.Spec, Backend.Status>,
): Promise<void> {
    const { apps, core } = getClients();

    const project = await readProjectUnsecure(namespaceToSlug(owner.metadata?.namespace!));

    if (!project) {
        throw 'Invalid Project';
    }

    const network = getNetworkFromAnnotations(spec.annotations) as Network;
    const deps = await getDependenciesForNetwork(project, network);
    const envVars = await buildEnvVars(deps, network);
    const cardanoNode = cardanoNodeDep(deps);
    const volumesList = workloadVolumes(name, !!cardanoNode);
    const containerList = containers(spec, envVars, cardanoNode);
    try {
        await apps.readNamespacedDeployment(name, ns);
        await checkConfigMapExistsOrCreate(core, ns, name, spec, owner);
        //@TODO sync
        await updateResource(ns, name, spec, containerList, volumesList, owner);
    } catch (err: any) {
        console.log(err?.body);
        await core.createNamespacedConfigMap(ns, configmap(name, spec, owner)).catch(err => console.log('configmap already exists'));
        await apps.createNamespacedDeployment(ns, deployment(name, spec, owner, containerList, volumesList));
    }
}

export async function updateResource(
    ns: string,
    name: string,
    spec: Backend.Spec,
    containers: V1Container[],
    volumes: V1Volume[],
    owner: CustomResource<Backend.Spec, Backend.Status>,
): Promise<void> {
    const { apps } = getClients();

    // patch resource
    const patchBody = {
        metadata: {
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
    await apps.patchNamespacedDeployment(name, ns, patchBody, undefined, undefined, undefined, undefined, undefined, options);
}

export async function updateResourceStatus(ns: string, name: string, resource: V1Deployment): Promise<void> {
    const { crd } = getClients();

    const mainContainer = resource.spec?.template.spec?.containers.find(i => i.name === 'main');

    const availableEnvVars = mainContainer?.env?.map(i => i.name);
    const owner = await loadResource(ns, name);

    const runningStatus = getDeploymentStatus(resource.status!, resource.spec?.replicas!, owner?.status?.runningStatus as WorkloadStatus);

    let computeDCUPerMin = 0;
    if (runningStatus === 'running' || runningStatus === 'degraded') {
        computeDCUPerMin = getComputeDCUPerMin(owner.spec.computeClass, resource.status?.availableReplicas || resource.spec?.replicas!);
    }

    // env vars should not be merged - to avoid multiple calls, we just replace the whole thing
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
            path: '/status/storageDCUPerMin',
            value: 0,
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

function deployment(
    name: string,
    spec: Backend.Spec,
    owner: CustomResource<Backend.Spec, Backend.Status>,
    containers: V1Container[],
    volumes: V1Volume[] | undefined,
): V1Deployment {
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
            replicas: spec.enabled ? spec.replicas : 0,
            revisionHistoryLimit: 5,
            selector: {
                matchLabels: {
                    'demeter.run/instance': name,
                },
            },
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

function containers(
    spec: Backend.Spec,
    envVars: V1EnvVar[],
    cardanoNodeDep: { dependency: DependencyResource; service: ServicePlugin } | null,
): V1Container[] {
    const args = spec.args ? spec.args.split(' ') : [];
    const command = spec.command ? spec.command.split(' ') : [];
    const volumeMounts: V1VolumeMount[] = [
        {
            name: 'config',
            mountPath: '/etc/config',
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
            resources: getResourcesFromComputeClass(spec.computeClass),
            image: spec.image,
            imagePullPolicy: 'IfNotPresent',
            volumeMounts,
            args,
            command,
            env: [...envVars, ...spec.envVars],
        },
    ];

    if (!!cardanoNodeDep) {
        containers.push(buildSocatContainer(cardanoNodeDep.dependency, cardanoNodeDep.service));
    }

    return containers;
}

async function loadResource(ns: string, name: string) {
    const { crd } = getClients();
    const res = (await crd.getNamespacedCustomObject(API_GROUP, API_VERSION, ns, PLURAL, name)) as CustomResourceResponse<
        Backend.Spec,
        Backend.Status
    >;
    return res.body;
}
