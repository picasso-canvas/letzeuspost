import { cpus, totalmem } from 'node:os';
import { optionsFromEnv } from './config.ts';
import { sampleBatch } from './batch.ts';
import { formatReport } from './report.ts';
import { runBench } from './run.ts';
import { checkSoak } from './soak.ts';

// The render benchmark's command line (README): `node packages/render/bench/main.ts`, or with `LZP_RENDER_SOAK=1` the
// 1,000-render soak. It prints the report to send back; a soak whose memory grew past the margin exits 1.

const options = optionsFromEnv(process.env, sampleBatch().length);
const host = `${process.platform} ${process.arch}, ${String(cpus().length)} cpus, ${String(Math.round(totalmem() / 1024 ** 3))} GB`;
console.log(
  `${options.soak ? 'Render soak' : 'Render benchmark'} on ${host}, node ${process.version}`,
);

const result = await runBench({
  renders: options.renders,
  progress: (done, total) => {
    if (done % 10 === 0 || done === total)
      console.log(`  ${String(done)} / ${String(total)} renders`);
  },
});

console.log(`\n${formatReport(result)}`);

if (options.soak) {
  const verdict = checkSoak(result.memory.samples);
  console.log(`\nsoak: ${verdict.ok ? 'PASS' : 'FAIL'}: ${verdict.message}`);
  if (!verdict.ok) process.exitCode = 1;
}
