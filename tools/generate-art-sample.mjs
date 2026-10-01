import { access, mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const gateway = 'https://gateway.agentsky.dev';
const { values } = parseArgs({ options: {
  variant: { type: 'string' },
  'prompt-file': { type: 'string' },
  out: { type: 'string' },
  size: { type: 'string', default: '1536x1024' },
  quality: { type: 'string', default: 'high' },
  reference: { type: 'string', multiple: true, default: [] },
  'run-id': { type: 'string' },
  'credential-fingerprint': { type: 'string' },
} });
if (!['flare', 'sunburst'].includes(values.variant) || !values['prompt-file'] || !values.out) {
  throw new Error('Required: --variant flare|sunburst --prompt-file PATH --out PATH.');
}
if (Boolean(values['run-id']) !== Boolean(values['credential-fingerprint'])) {
  throw new Error('Resuming requires both --run-id and --credential-fingerprint.');
}
const output = resolve(root, values.out);
const outputRelative = relative(root, output);
if (outputRelative.startsWith('..') || isAbsolute(outputRelative) || !output.endsWith('.png')) {
  throw new Error('Output must be a PNG within the workspace.');
}
const endpoint = `gpt-image-2.5-${values.variant}`;
const prompt = (await readFile(resolve(root, values['prompt-file']), 'utf8')).trim();
if (!prompt || prompt.length > 32000) throw new Error('Prompt must contain 1-32000 characters.');
const input = { prompt, n: 1, size: values.size, quality: values.quality,
  output_format: 'png', response_format: 'b64_json' };
const digest = value => createHash('sha256').update(value).digest('hex');
if (values.reference.length > 16) throw new Error('At most 16 reference images are supported.');
const references = await Promise.all(values.reference.map(async path => {
  const absolute = resolve(root, path);
  const local = relative(root, absolute);
  if (local.startsWith('..') || isAbsolute(local)) throw new Error('References must be within the workspace.');
  const data = await readFile(absolute);
  if (data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('References must be PNG files.');
  }
  return { b64: data.toString('base64') };
}));
if (references.length) input.images = references;
if (Buffer.byteLength(JSON.stringify(input)) > 31 * 1024 * 1024) {
  throw new Error('Request is too large for the gateway; use fewer or smaller references.');
}
const exists = async path => {
  try { await access(path); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

if (await exists(output)) {
  console.log(`${endpoint}: already saved; no API request.`);
} else {
  await mkdir(dirname(output), { recursive: true });
  const lockPath = `${output}.lock`;
  const lock = await open(lockPath, 'wx');
  try {
    if (await exists(output)) throw new Error('Output appeared while acquiring the lock; no API request.');
    const keys = [...new Set((await readFile(resolve(root, 'keys.txt'), 'utf8'))
      .match(/\bast_[A-Za-z0-9_-]+\b/g) ?? [])];
    if (!keys.length) throw new Error('No gateway credential found in keys.txt.');
    let key;
    let runId = values['run-id'];
    if (runId) {
      key = keys.find(candidate => digest(candidate) === values['credential-fingerprint']);
      if (!key) throw new Error('Accepted task credential is missing; refusing to query with another account.');
    }
    const api = async (path, body, idempotencyKey) => {
      const response = await fetch(`${gateway}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(body ? 660000 : 90000),
      });
      let result;
      try { result = await response.json(); } catch {
        throw new Error(`Gateway HTTP ${response.status}: non-JSON response; no automatic replacement.`);
      }
      if (!response.ok) {
        const message = String(result.error?.message ?? '').replace(/ast_[A-Za-z0-9_-]+/g, '[redacted]');
        const error = new Error(`Gateway HTTP ${response.status}: ${message}; no automatic replacement.`);
        error.status = response.status;
        error.result = result;
        throw error;
      }
      return result;
    };
    let result;
    if (!runId) {
      for (const candidate of keys) {
        key = candidate;
        console.log(`${endpoint}: submitting one image, ${values.size}, ${values.quality}.`);
        try {
          result = await api('/v1/run', { provider: 'openai', endpoint, input }, randomUUID());
        } catch (error) {
          if (error.result?.runId) {
            console.log(JSON.stringify({ runId: error.result.runId, credentialFingerprint: digest(key) }));
          }
          const depleted = error.status === 402 && error.result?.error?.code === 'insufficient_credits'
            && !error.result?.runId;
          if (!depleted) throw error;
          console.log(`${endpoint}: insufficient credits; trying the next user-authorized credential.`);
          continue;
        }
        if (!result.runId) throw new Error('Submission has no runId. Reconcile manually; do not submit again.');
        runId = result.runId;
        break;
      }
      if (!runId) throw new Error('All authorized credentials were rejected for insufficient credits.');
    }
    // Resume identifiers stay in terminal output, not in a persistent task ledger.
    console.log(JSON.stringify({ runId, credentialFingerprint: digest(key) }));
    console.log('To resume, supply --run-id and --credential-fingerprint; do not submit a replacement.');
    const deadline = Date.now() + 660000;
    let pollPath;
    let lastStatus;
    let lastLog = 0;
    while (true) {
      if (!result) {
        const encodedRunId = encodeURIComponent(runId);
        if (pollPath) {
          result = await api(pollPath);
        } else {
          try {
            result = await api(`/v1/run/${encodedRunId}`);
            pollPath = `/v1/run/${encodedRunId}`;
          } catch (error) {
            if (error.status !== 404) throw error;
            result = await api(`/v1/runs/${encodedRunId}`);
            pollPath = `/v1/runs/${encodedRunId}`;
          }
        }
      }
      if (result.status !== lastStatus || Date.now() - lastLog >= 30000) {
        console.log(`${endpoint}: ${result.status}.`);
        lastStatus = result.status;
        lastLog = Date.now();
      }
      if (result.status === 'COMPLETED') {
        const images = result.output?.data;
        if (!Array.isArray(images) || images.length !== 1 || !images[0].b64_json) {
          throw new Error('Expected exactly one base64 image; use the same run ID to query again.');
        }
        const image = Buffer.from(images[0].b64_json, 'base64');
        if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
          throw new Error('Response is not a PNG; use the same run ID to query again.');
        }
        const width = image.readUInt32BE(16);
        const height = image.readUInt32BE(20);
        await writeFile(output, image, { flag: 'wx' });
        console.log(JSON.stringify({ output, width, height }));
        break;
      }
      if (['FAILED', 'CANCELLED'].includes(result.status)) {
        throw new Error(`Gateway task ${result.status}; no automatic replacement.`);
      }
      if (Date.now() >= deadline) throw new Error('Polling deadline reached; resume with the run ID and credential fingerprint.');
      await sleep(5000);
      result = undefined;
    }
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}
