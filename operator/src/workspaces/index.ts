import { stsInformer, pvcInformer } from './informer';
import Operator from './controller';
import { executeRecurrentTask } from '../utils';
import { checkWorkspaceUptime } from './uptime';

const AUTOSTOP_MIN_INTERVAL = 5 * 60 * 1000;
const AUTOSTOP_DESIRED_INTERVAL = process.env.UPTIME_INTERVAL_S ? Number(process.env.UPTIME_INTERVAL_S) * 1000 : AUTOSTOP_MIN_INTERVAL;


const operator = new Operator();

const exit = (reason: string) => {
    operator.stop();
    stsInformer.stop();
    pvcInformer.stop();
    process.exit(0);
};

process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'));

export default async function start() {
    await stsInformer.start();
    await pvcInformer.start();
    await operator.start();
    executeRecurrentTask(checkWorkspaceUptime, { label: 'uptime', desiredInterval: AUTOSTOP_DESIRED_INTERVAL, minInterval: AUTOSTOP_MIN_INTERVAL });
}
