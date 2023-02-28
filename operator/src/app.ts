import express from 'express';
import { register } from './metrics/prometheus';
import startDataWorker from './data-workers';
import collectMetrics from './metrics';
import { registerServices } from './services';

const server = express();

const port = process.env.PORT || 9946;
console.log(`Server listening to ${port}, metrics exposed on /metrics endpoint`);
server.listen(port);

server.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (ex) {
        res.status(500).end(ex);
    }
});

registerServices();
startDataWorker();
collectMetrics();
