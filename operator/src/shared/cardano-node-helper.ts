import { DependencyResource, DependencySpec, EnvVar, Network, ServicePlugin, ServicePort } from '@demeter-sdk/framework';
import { V1Container } from '@kubernetes/client-node';

const MAGIC_BY_NETWORK: Record<Network, string> = {
    preview: '2',
    preprod: '1',
    testnet: '1097911063',
    mainnet: '764824073',
};

function networkMagic(network: Network): string | undefined {
    return MAGIC_BY_NETWORK[network];
}

function parseDependency(dep: DependencyResource): { network: Network } {
    const annotations = dep.spec.annotations || {};
    const network = annotations['cardano.demeter.run/network'] as Network;
    return { network };
}

function buildServiceName(dep: DependencyResource, port: ServicePort): string {
    return `${dep.metadata?.name!}-${port.name}`;
}

function nodePrivateDns(dep: DependencyResource, service: ServicePlugin) {
    const ports = service.metadata.ports;
    if (!ports) throw new Error(`Service ${service.metadata?.key} does not have any ports defined`);
    const n2cPort = ports.find(p => p.name === 'n2c')!;
    const nodePrivateDNS = buildServiceName(dep, n2cPort);
    return `${nodePrivateDNS}:${n2cPort.port}`;
}

function buildSocatArgs(dep: DependencyResource, service: ServicePlugin) {
    const nodePrivateDNS = nodePrivateDns(dep, service);
    return ['UNIX-LISTEN:/ipc/node.socket,reuseaddr,fork,unlink-early', `TCP-CONNECT:${nodePrivateDNS}`];
}

export function getCardanoNodeEnvVars(dep: DependencyResource, service: ServicePlugin): EnvVar[] {
    const { network } = parseDependency(dep);
    const nodePrivateDNS = nodePrivateDns(dep, service);
    const host = nodePrivateDNS.split(':')[0];
    const port = nodePrivateDNS.split(':')[1];
    return [
        { name: 'CARDANO_NODE_HOST', value: host },
        { name: 'CARDANO_NODE_PORT', value: port },
        { name: 'CARDANO_NODE_MAGIC', value: networkMagic(network)! },
        { name: 'CARDANO_TESTNET_MAGIC', value: networkMagic(network)! },
        { name: 'CARDANO_NODE_SOCKET_PATH', value: '/ipc/node.socket' },
    ];
}

export function buildSocatContainer(dep: DependencyResource, service: ServicePlugin): V1Container {
    return {
        name: 'socat',
        image: 'alpine/socat',
        securityContext: {
            runAsUser: 1000,
            runAsGroup: 1000,
        },
        args: buildSocatArgs(dep, service),
        volumeMounts: [
            {
                name: 'ipc',
                mountPath: '/ipc',
            },
        ],
    };
}
