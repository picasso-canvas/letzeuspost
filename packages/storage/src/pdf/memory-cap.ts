// The PDF reader's memory cap (#402): a thread of the reader process (./read-pdf-text.ts) that ends the whole process
// the moment its resident memory passes the cap. Resident memory counts everything the process holds: pdf.js's objects
// and the typed arrays it inflates a stream into, which live outside V8's heap and so outside `--max-old-space-size`.
// The check runs on its own thread, so it keeps running while pdf.js holds the reader's one thread in a long inflate.
// SIGKILL can't be caught or delayed; pdf.ts reads a SIGKILL it didn't send as this cap.
import { workerData } from 'node:worker_threads';

const capBytes = Number(workerData);
if (!Number.isSafeInteger(capBytes) || capBytes <= 0) throw new Error('memory cap: no cap given');

// Every 10 ms: a stream inflates at about 1 GB a second, so the process ends within about 10 MB past the cap.
setInterval(() => {
  if (process.memoryUsage.rss() > capBytes) process.kill(process.pid, 'SIGKILL');
}, 10);
