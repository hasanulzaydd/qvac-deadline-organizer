import {
  loadModel,
  unloadModel,
  close,
  OCR_LATIN,
  QWEN3_4B_INST_Q4_K_M,
  type ModelProgressUpdate,
} from '@qvac/sdk';

/**
 * QVAC runs on-device and loads multi-gigabyte weights. Next.js dev mode
 * re-evaluates modules on every hot reload, so the loaded model ids live on
 * globalThis: the models survive reloads and are downloaded exactly once.
 */

export const LLM_CONTEXT_TOKENS = 8192;

export type QvacModels = {
  ocrModelId: string;
  llmModelId: string;
};

type QvacState = {
  ready: Promise<QvacModels> | null;
  models: QvacModels | null;
  error: string | null;
  shutdownHooked: boolean;
};

const globalWithQvac = globalThis as typeof globalThis & {
  __qvac?: QvacState;
};

const state: QvacState = (globalWithQvac.__qvac ??= {
  ready: null,
  models: null,
  error: null,
  shutdownHooked: false,
});

/** Per-download throttle so a multi-GB pull logs progress instead of flooding. */
function makeProgressLogger(label: string) {
  const lastLogged = new Map<string, number>();

  return (p: ModelProgressUpdate) => {
    const seen = lastLogged.get(p.downloadKey) ?? -1;
    const step = Math.floor(p.percentage / 5);
    if (step <= seen && p.percentage < 100) return;
    lastLogged.set(p.downloadKey, step);

    const mb = (n: number) => (n / 1_000_000).toFixed(0);
    const shard = p.shardInfo
      ? ` shard ${p.shardInfo.currentShard}/${p.shardInfo.totalShards}`
      : '';
    const fileSet = p.fileSetInfo
      ? ` file ${p.fileSetInfo.fileIndex + 1}/${p.fileSetInfo.totalFiles} (${p.fileSetInfo.currentFile})`
      : '';

    console.log(
      `[qvac] ${label}${shard}${fileSet} ${p.percentage.toFixed(1)}% ` +
        `${mb(p.downloaded)}/${mb(p.total)} MB`,
    );
  };
}

function registerShutdown() {
  if (state.shutdownHooked) return;
  state.shutdownHooked = true;

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const models = state.models;
    try {
      if (models) {
        await unloadModel({ modelId: models.ocrModelId });
        await unloadModel({ modelId: models.llmModelId });
      }
      await close();
      console.log('[qvac] models unloaded, SDK closed');
    } catch (err) {
      console.error('[qvac] shutdown failed:', err);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void shutdown().finally(() => process.exit(0));
    });
  }
  process.once('beforeExit', () => {
    void shutdown();
  });
}

async function initModels(): Promise<QvacModels> {
  const startedAt = Date.now();
  console.log('[qvac] loading models (first run downloads several GB)…');

  // OCR: EasyOCR pipeline. OCR_LATIN is the latin recogniser; the CRAFT text
  // detector is auto-derived by the registry, so it is one loadModel call.
  console.log(`[qvac] OCR model: ${OCR_LATIN.name}`);
  const ocrModelId = await loadModel({
    modelSrc: OCR_LATIN,
    onProgress: makeProgressLogger('ocr'),
  });
  console.log(`[qvac] OCR ready (${Math.round((Date.now() - startedAt) / 1000)}s)`);

  // Text LLM: used later to turn raw OCR text into structured records.
  console.log(`[qvac] LLM model: ${QWEN3_4B_INST_Q4_K_M.name}`);
  // The SDK default context is 1024 tokens — too small for a routine's OCR
  // text plus the prompt plus a JSON reply. 8192 costs ~1.2 GB of KV cache
  // on top of the 2.5 GB weights (fits a 6 GB GPU).
  const llmModelId = await loadModel({
    modelSrc: QWEN3_4B_INST_Q4_K_M,
    modelConfig: { ctx_size: LLM_CONTEXT_TOKENS },
    onProgress: makeProgressLogger('llm'),
  });
  console.log(`[qvac] LLM ready (${Math.round((Date.now() - startedAt) / 1000)}s)`);

  const models: QvacModels = { ocrModelId, llmModelId };
  state.models = models;
  state.error = null;
  registerShutdown();

  console.log(
    `[qvac] both models loaded in ${Math.round((Date.now() - startedAt) / 1000)}s`,
  );
  return models;
}

/**
 * Loads both models once per process. Concurrent callers share one promise,
 * so a burst of requests during startup cannot trigger a second download.
 */
export function getQvac(): Promise<QvacModels> {
  if (!state.ready) {
    state.ready = initModels().catch((err: unknown) => {
      // Clear the memo so a later request can retry instead of replaying
      // a rejected promise forever.
      state.ready = null;
      state.error = err instanceof Error ? err.message : String(err);
      console.error('[qvac] model load failed:', err);
      throw err;
    });
  }
  return state.ready;
}

/** Non-blocking snapshot for /api/health — never starts a load itself. */
export function getQvacStatus() {
  return {
    ocrReady: Boolean(state.models?.ocrModelId),
    llmReady: Boolean(state.models?.llmModelId),
    loading: Boolean(state.ready) && !state.models,
    error: state.error,
    ocrModel: OCR_LATIN.name,
    llmModel: QWEN3_4B_INST_Q4_K_M.name,
  };
}
