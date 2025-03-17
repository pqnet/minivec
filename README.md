# Minivec

A minimal document store with semantic retrieval based upon embedding vectors and reranking

## Getting started

```bash
podman run -it --rm -p 3000:3000 docker.io/pqnet/minivec
```

or using `docker`:

```bash
docker run -it --rm -p 3000:3000 pqnet/minivec
```

## Creating Indices

Minivec now supports multiple indices for different document properties. First, create an index:

```bash
# Create default index for document content
curl -X POST -H "Content-Type: application/json" -d '{"name":"default","indexedPropertyPath":"$.content","description":"Default content index"}' localhost:3000/api/indices

# Create another index for document titles
curl -X POST -H "Content-Type: application/json" -d '{"name":"title-index","indexedPropertyPath":"$.title","description":"Index for document titles"}' localhost:3000/api/indices
```

## Adding Documents

Add new documents to the store with a HTTP POST, specifying which indices to use:

```bash
# Add documents with content and title to both indices
curl -X POST -H "Content-Type: application/json" -d '{
  "documents": [
    {
      "content": "Artificial intelligence is transforming industries across the globe.",
      "title": "AI Revolution",
      "metadata": { "tags": ["ai", "technology"] }
    }
  ],
  "indices": ["default", "title-index"]
}' localhost:3000/api/documents
```

## Searching Documents

Search using HTTP GET, specifying which index to use:

```bash
# Search using the default content index
curl 'localhost:3000/api/documents?q=artificial%20intelligence'

# Search using the title index
curl 'localhost:3000/api/documents?q=revolution&index=title-index'
```

## Listing Available Indices

List all available indices:

```bash
curl 'localhost:3000/api/indices'
```

## Building Indices for Existing Documents

If you add new indices after inserting documents, you can build embeddings for existing documents:

```bash
curl -X POST 'localhost:3000/api/indices/title-index/build'
```

## Persistence
By default models are downloaded in the `/models` directory and the database is saved in the `/app/.data` directory (inside the container).
To allow re-using model cache, or to persist the saved vectors between runs, you can map host directories or mount named volumes at these paths, e.g.

```bash
podman run -it --rm -p 3000:3000 -v minivec-models-cache:/models -v minivec-data:/app/.data docker.io/pqnet/minivec
```

(similarly with `docker`)
```bash
docker run -it --rm -p 3000:3000 -v minivec-models-cache:/models -v minivec-data:/app/.data pqnet/minivec
```

## Configuration
Use environment variables to configure which models to load. see [nitro.config.ts](nitro.config.ts) for a full list of the usable variables

### Model choice
`bge-m3` (for embedding) and `bge-reranker-v2-m3` (for reranking) are automatically downloaded and used by the container.
It is possible to choose different models by specifying a local file name, an http/https URL or an huggingface repository to download the models automatically.
See https://node-llama-cpp.withcat.ai/guide/downloading-models for the list of compatible URL schemes and parameters.

For a simpler deployment in cloud environments and similar we recommend creating a custom container and copy your models inside of it.
It is also possible to copy a database file in the container image and disable write operations.

```dockerfile
FROM docker.io/pqnet/minivec:latest

# Add models to the image
COPY my-embedding-model.gguf /models/my-embedding-model.gguf
COPY my-ranking-model.gguf /models/my-ranking-model.gguf
ENV NITRO_LOCAL_MODELS_EMBED_MODEL_FILE=my-embedding-model.gguf
ENV NITRO_LOCAL_MODELS_RANK_MODEL_FILE=my-ranking-model.gguf

# preload a database file, and disable writing to the store (for inference loads)
COPY db.sqlite3 /app/.data/db.sqlite3
ENV NITRO_DISABLE_WRITE=true
```

## Document Structure

Documents in Minivec have flexible JSON structures. The only requirement is that the property referenced by the index's `indexedPropertyPath` must exist as a string when you want to index the document.

Examples of valid documents:

```json
// Simple document with content property
{ "content": "This is the document content" }

// Document with nested properties
{
  "title": "My Document",
  "details": {
    "content": "This is the document content",
    "author": "John Doe"
  },
  "metadata": {
    "tags": ["example", "documentation"]
  }
}
```

You can index different properties by creating indices with appropriate JSON paths, such as `$.content`, `$.title`, or `$.details.content`.
