import { getLlama } from "node-llama-cpp";
import { pathToFileURL, fileURLToPath } from "url";

function getModelPath(type: "embed" | "rank") {
  const cwd = pathToFileURL(process.cwd() + "/");
  const { localModels } = useRuntimeConfig();
  const modelBase = new URL(localModels.baseDir + "/", cwd);
  const key = `${type}ModelFile` as const;
  const modelUrl = new URL(localModels[key], modelBase);
  return fileURLToPath(modelUrl);
}
const llamaPromise = getLlama({ gpu: false });
const embedModelPromise = llamaPromise.then((llama) =>
  llama.loadModel({
    modelPath: getModelPath("embed"),
  })
);
const rerankModelPromise = llamaPromise.then((llama) =>
  llama.loadModel({
    modelPath: getModelPath("rank"),
  })
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
