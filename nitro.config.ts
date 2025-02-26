import { defineNitroConfig } from "nitropack/config";

export default defineNitroConfig({
  compatibilityDate: "2025-02-23",
  srcDir: "server",
  experimental: {
    database: true,
  },
  runtimeConfig: {
    localModels: {
      baseDir: "./models/",
      embedModelFile: "bge-m3-q8_0.gguf",
      rankModelFile: "bge-reranker-v2-m3-q8_0.gguf",
    },
  },
});
