export async function executeRecurrentTask(task: () => Promise<void>, options: { label: string; desiredInterval: number; minInterval: number }) {
    console.time(options.label);
    const start = Date.now();

    try {
        await task();
    } catch (err) {
        console.error(err);
    }

    console.timeEnd(options.label);
    const end = Date.now();

    const timeout = Math.max(options.desiredInterval - (end - start), options.minInterval);

    setTimeout(() => executeRecurrentTask(task, options), timeout);
}
