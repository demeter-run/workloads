import { stsInformer, pvcInformer } from './informer';
import Operator from './controller';
import { executeRecurrentTask } from '../utils';
import { checkWorkspaceIdle } from './idle';
import { checkWorkspaceExpired } from './expired';

const AUTOSTOP_MIN_INTERVAL = 5 * 60 * 1000;
const AUTOSTOP_DESIRED_INTERVAL = process.env.IDLE_INTERVAL_S ? Number(process.env.IDLE_INTERVAL_S) * 1000 : AUTOSTOP_MIN_INTERVAL;
const EXPIRE_MIN_INTERVAL = 2 * 60 * 60 * 1000; // 2 hours

const EXPIRE_DESIRED_INTERVAL = process.env.EXPIRE_INTERVAL_S ? Number(process.env.EXPIRE_INTERVAL_S) * 1000 : EXPIRE_MIN_INTERVAL;

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
    executeRecurrentTask(checkWorkspaceIdle, { label: 'uptime', desiredInterval: AUTOSTOP_DESIRED_INTERVAL, minInterval: AUTOSTOP_MIN_INTERVAL });
    executeRecurrentTask(checkWorkspaceExpired, { label: 'expired', desiredInterval: EXPIRE_DESIRED_INTERVAL, minInterval: EXPIRE_MIN_INTERVAL });
}
