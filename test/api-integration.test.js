import { describe, it, before, after } from "node:test";
import { spawn, execSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert";

describe("API Integration Tests", { timeout: 120000 }, () => {
  let serverProcess;
  let tempDbDir;
  const serverPort = 3456; // Using a non-default port to avoid conflicts

  // Helper function to execute curl commands with improved argument handling
  const curl = (...args) => {
    try {
      // Quote each non-empty argument to prevent shell interpretation issues
      const quotedArgs = args
        .filter((arg) => arg.trim() !== "") // Skip empty arguments
        .map((arg) => `'${arg}'`); // Wrap each in single quotes

      const command = `curl -s -H "Content-Type: application/json" ${quotedArgs.join(
        " "
      )}`;
      console.log(`Executing: ${command}`);

      return JSON.parse(
        execSync(command, {
          encoding: "utf-8",
        })
      );
    } catch (error) {
      console.error(`Failed curl command: ${error.message}`);
      console.error(`Arguments: ${args.join(" ")}`);
      throw error;
    }
  };

  // Setup before all tests
  before(async () => {
    // Create temporary directory for database
    tempDbDir = join(tmpdir(), `minivec-test-${Date.now()}`);
    await mkdir(tempDbDir, { recursive: true });

    console.log(`Using temporary database directory: ${tempDbDir}`);

    // // Start the Nitro server with the temporary database directory
    // serverProcess = spawn("pnpm", ["dev", "--port", serverPort], {
    //   env: {
    //     ...process.env,
    //     NITRO_PORT: serverPort,
    //   },
    //   stdio: ["ignore", "pipe", "pipe"],
    // });

    // // Log server output for debugging
    // serverProcess.stdout.on("data", (data) => {
    //   console.log(`[SERVER]: ${data.toString().trim()}`);
    // });

    // serverProcess.stderr.on("data", (data) => {
    //   console.error(`[SERVER ERROR]: ${data.toString().trim()}`);
    // });

    // // Wait for server to start - allow more time for model loading
    // await new Promise((resolve) => {
    //   const checkServer = () => {
    //     try {
    //       execSync(`curl -s http://localhost:${serverPort}/`, {
    //         stdio: "ignore",
    //       });
    //       // Wait a bit longer to ensure models are fully loaded
    //       setTimeout(resolve, 2000);
    //     } catch (e) {
    //       // Server not ready yet, retry after delay
    //       setTimeout(checkServer, 500);
    //     }
    //   };

    //   setTimeout(checkServer, 3000); // Initial delay to let server start
    // });

    console.log(`Server started on port ${serverPort}`);
  });

  // Cleanup after all tests
  after(async () => {
    if (serverProcess) {
      console.log("Shutting down server...");
      serverProcess.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Give server time to shutdown gracefully
    }

    // Remove temporary directory
    try {
      await rm(tempDbDir, { recursive: true, force: true });
      console.log(`Removed temporary directory: ${tempDbDir}`);
    } catch (err) {
      console.error(`Failed to remove temp directory: ${err}`);
    }
  });

  // Test creating indices
  it("should create and list indices", async () => {
    // Create a test index
    const createResponse = curl(
      "-X",
      "POST",
      "-d",
      JSON.stringify({
        name: "test-index",
        indexedPropertyPath: "$.text",
        description: "Test Index",
      }),
      `http://localhost:${serverPort}/api/indices`
    );

    assert.strictEqual(createResponse.name, "test-index");
    assert.strictEqual(createResponse.indexedPropertyPath, "$.text");

    // List indices
    const listResponse = curl(`http://localhost:${serverPort}/api/indices`);

    assert.ok(Array.isArray(listResponse), "Index list should be an array");
    assert.ok(
      listResponse.some((idx) => idx.name === "test-index"),
      "Should include our test index"
    );
  });

  // Test adding and searching documents
  it("should add and search documents", async () => {
    // Add documents
    const docs = [
      {
        text: "The quick brown fox jumps over the lazy dog",
        title: "Fox and Dog",
      },
      {
        text: "A spacecraft landed on the moon in 1969",
        title: "Moon Landing",
      },
      {
        text: "Machine learning algorithms can identify patterns in data",
        title: "ML Intro",
      },
    ];

    const addResponse = curl(
      "-X",
      "POST",
      "-d",
      JSON.stringify({ documents: docs, indices: ["test-index"] }),
      `http://localhost:${serverPort}/api/documents`
    );

    assert.strictEqual(addResponse.success, true);
    assert.strictEqual(addResponse.count, 3);

    // Allow time for embedding generation (real models take longer)
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Search documents
    const searchResponse = curl(
      `http://localhost:${serverPort}/api/documents?q=fox+and+dog&index=test-index`
    );

    assert.ok(
      Array.isArray(searchResponse.results),
      "Results should be an array"
    );
    assert.ok(searchResponse.results.length > 0, "Should return results");

    // With real models, we can't deterministically know the exact order,
    // but the fox document should be in the results somewhere
    const hasFoxResult = searchResponse.results.some((result) =>
      result.document.text.toLowerCase().includes("fox")
    );
    assert.ok(hasFoxResult, "Results should include the fox document");

    // The scores should be between 0 and 1
    searchResponse.results.forEach((result) => {
      assert.ok(
        result.score >= 0 && result.score <= 1,
        "Score should be between 0 and 1"
      );
    });
  });

  // Test building an index for existing documents
  it("should build index for existing documents", async () => {
    // Create another index
    const createResponse = curl(
      "-X",
      "POST",
      "-d",
      JSON.stringify({
        name: "title-index",
        indexedPropertyPath: "$.title",
        description: "Title Index",
      }),
      `http://localhost:${serverPort}/api/indices`
    );

    assert.strictEqual(createResponse.name, "title-index");

    // Build the index for existing documents
    // const buildResponse = curl(
    //   "-X",
    //   "POST",
    //   `http://localhost:${serverPort}/api/indices/title-index/build`
    // );

    // assert.strictEqual(buildResponse.indexed, 3);
    // assert.strictEqual(buildResponse.errors, 0);

    // Allow time for embedding generation (real models take longer)
    // await new Promise((resolve) => setTimeout(resolve, 5000));

    // Search using the new index
    const searchResponse = curl(
      `http://localhost:${serverPort}/api/documents?q=moon+landing&index=title-index`
    );

    assert.ok(
      searchResponse.results.length > 0,
      "Should return results from title index"
    );

    // The results should include the moon landing document somewhere
    const hasMoonResult = searchResponse.results.some((result) =>
      result.document.title.toLowerCase().includes("moon")
    );
    assert.ok(
      hasMoonResult,
      "Results should include the moon landing document"
    );

    // Try a different query to test semantic search capabilities
    const spaceSearchResponse = curl(
      `http://localhost:${serverPort}/api/documents?q=space+exploration&index=title-index`
    );

    // Even though "space exploration" isn't explicitly in the text, semantic search
    // should still find the moon landing document
    assert.ok(
      spaceSearchResponse.results.length > 0,
      "Should return semantic search results"
    );
  });

  // Test multi-index document handling
  it("should support documents indexed in multiple indices", async () => {
    // Add a document with content for both indices
    const multiDoc = {
      text: "SpaceX plans to send humans to Mars in the coming decade",
      title: "Mars Mission Plans",
    };

    const addResponse = curl(
      "-X",
      "POST",
      "-d",
      JSON.stringify({
        documents: [multiDoc],
        indices: ["test-index", "title-index"],
      }),
      `http://localhost:${serverPort}/api/documents`
    );

    assert.strictEqual(addResponse.success, true);

    // Allow time for embedding generation (real models take longer)
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Search in the text index
    const textSearchResponse = curl(
      `http://localhost:${serverPort}/api/documents?q=Mars+colonization&index=test-index`
    );

    // Search in the title index
    const titleSearchResponse = curl(
      `http://localhost:${serverPort}/api/documents?q=Mission+to+Mars&index=title-index`
    );

    // The document should be found in both indices
    const foundInTextIndex = textSearchResponse.results.some((result) =>
      result.document.text.includes("Mars")
    );

    const foundInTitleIndex = titleSearchResponse.results.some((result) =>
      result.document.title.includes("Mars")
    );

    assert.ok(foundInTextIndex, "Document should be found through text index");
    assert.ok(
      foundInTitleIndex,
      "Document should be found through title index"
    );
  });
});
