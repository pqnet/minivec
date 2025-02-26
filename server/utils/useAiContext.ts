import { access, constants } from "fs/promises";
import {
  createModelDownloader,
  getLlama,
  resolveModelFile,
} from "node-llama-cpp";
import { pathToFileURL, fileURLToPath } from "url";

async function getModelPath(type: "embed" | "rank") {
  const cwd = pathToFileURL(process.cwd() + "/");
  const { localModels } = useRuntimeConfig();
  const modelBase = new URL(localModels.baseDir + "/", cwd);
  const key = `${type}ModelFile` as const;
  const modelPath = await resolveModelFile(localModels[key], {
    directory: fileURLToPath(modelBase),
  });

  if (
    !(await access(modelPath, constants.R_OK).then(
      () => true,
      () => false
    ))
  ) {
    // file does not exist, attempt downloading it
    if (
      localModels[key].startsWith("http:") ||
      localModels[key].startsWith("https:") ||
      localModels[key].startsWith("hf:")
    ) {
      const modelDownloader = await createModelDownloader({
        dirPath: fileURLToPath(modelBase),
        modelUri: localModels[key],
      });
      return await modelDownloader.download();
    }
    throw new Error(`Model file not found: ${modelPath}`);
  }
  return modelPath;
}
const llamaPromise = getLlama({ gpu: false });
const embedModelPromise = llamaPromise.then((llama) =>
  getModelPath("embed").then((modelPath) =>
    llama.loadModel({
      modelPath,
    })
  )
);
const rerankModelPromise = llamaPromise.then((llama) =>
  getModelPath("rank").then((modelPath) =>
    llama.loadModel({
      modelPath,
    })
  )
);
const embeddingContextPromise = embedModelPromise.then((model) =>
  model.createEmbeddingContext({})
);
const rankingContextPromise = rerankModelPromise.then((model) =>
  model.createRankingContext({})
);

export async function getEmbeddingContext() {
  return await embeddingContextPromise;
}
export async function getRankingContext() {
  return await rankingContextPromise;
}
export async function useAiContext() {
  return {
    embeddingContext: await embeddingContextPromise,
    rankingContext: await rankingContextPromise,
  };
}
export default useAiContext;
