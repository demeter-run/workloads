import { PatchUtils, V1Container, V1EnvVar, V1Volume, V1VolumeMount, V1Deployment } from '@kubernetes/client-node';
import { getClients, readProjectUnsecure, Network, namespaceToSlug } from '@demeter-sdk/framework';
import { API_VERSION, API_GROUP, PLURAL } from './constants';
import { CustomResource, CustomResourceResponse, Frontend, WorkloadStatus } from '@demeter-run/workloads-types';
import { buildEnvVars, getDependenciesForNetwork, isCardanoNodeEnabled } from '../shared/dependencies';
import {
    buildSocatArgs,
    getComputeDCUPerMin,
    getDeploymentStatus,
    getNetworkFromAnnotations,
    getResourcesFromComputeClass,
    workloadVolumes,
} from '../shared';
import { checkConfigMapExistsOrCreate, configmap } from '../shared/configmap';

export async function handleResource(
    ns: string,
    name: string,
    spec: Frontend.Spec,
    owner: CustomResource<Frontend.Spec, Frontend.Status>,
): Promise<void> {
    const { apps, core } = getClients();

    const project = await readProjectUnsecure(namespaceToSlug(owner.metadata?.namespace!));

    if (!project) {
        throw 'Invalid Project';
    }

    const network = getNetworkFromAnnotations(spec.annotations) as Network;
    const deps = await getDependenciesForNetwork(project, network);
    const envVars = await buildEnvVars(deps, network);
    const usesCardanoNode = isCardanoNodeEnabled(deps);
    const volumesList = workloadVolumes(name, usesCardanoNode);
    const containerList = containers(spec, envVars, usesCardanoNode);
    try {
        await apps.readNamespacedDeployment(name, ns);
        await checkConfigMapExistsOrCreate(core, ns, name, spec, owner);
        //@TODO sync
        await updateResource(ns, name, spec, containerList, volumesList);
    } catch (err: any) {
        console.log(err?.body);
        await core.createNamespacedConfigMap(ns, configmap(name, spec, owner));
        await apps.createNamespacedDeployment(ns, deployment(name, spec, owner, containerList, volumesList));
    }
}

export async function updateResource(ns: string, name: string, spec: Frontend.Spec, containers: V1Container[], volumes: V1Volume[]): Promise<void> {
    const { apps } = getClients();

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
    spec: Frontend.Spec,
    owner: CustomResource<Frontend.Spec, Frontend.Status>,
    containers: V1Container[],
    volumes: V1Volume[] | undefined,
): V1Deployment {
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
                    volumes,
                },
            },
        },
    };
}

function containers(spec: Frontend.Spec, envVars: V1EnvVar[], usesCardanoNode: boolean): V1Container[] {
    const args = spec.args ? spec.args.split(' ') : [];
    const command = spec.command ? spec.command.split(' ') : [];
    const volumeMounts: V1VolumeMount[] = [
        {
            name: 'config',
            mountPath: '/etc/config',
        },
    ];

    if (usesCardanoNode) {
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

    if (usesCardanoNode) {
        containers.push({
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
        });
    }

    return containers;
}

async function loadResource(ns: string, name: string) {
    const { crd } = getClients();
    const res = (await crd.getNamespacedCustomObject(API_GROUP, API_VERSION, ns, PLURAL, name)) as CustomResourceResponse<
        Frontend.Spec,
        Frontend.Status
    >;
    return res.body;
}
