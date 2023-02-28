import informer from './informer';
import Operator from './controller';

const operator = new Operator();

const exit = (reason: string) => {
    operator.stop();
    informer.stop();
    process.exit(0);
};

process.on('SIGTERM', () => exit('SIGTERM')).on('SIGINT', () => exit('SIGINT'));

export default async function start() {
    await informer.start();
    await operator.start();
}
