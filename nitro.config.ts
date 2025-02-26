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
      embedModelFile: "hf:pqnet/bge-m3-Q8_0-GGUF:Q8_0",
      rankModelFile: "hf:pqnet/bge-reranker-v2-m3-Q8_0-GGUF:Q8_0",
    },
  },
});
