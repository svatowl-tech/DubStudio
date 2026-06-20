import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function test() {
  const { pipeline, env } = await import('@xenova/transformers');
  console.log("Starting test...");
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.cacheDir = path.join(__dirname, 'test-models');
  try {
    const config = {
      progress_callback: (p) => {
        console.log(`Progress: ${p.status} - ${p.file} - ${p.progress}`);
      }
    };
    const translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', config);
    console.log("Loaded translator");
  } catch (err) {
    console.error("Test failed", err);
  }
}

test();
