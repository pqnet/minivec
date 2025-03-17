import type { Connector, Database, Primitive } from "db0";
import type { Database as BetterSqlite3Database } from "better-sqlite3";

type Db = Database<Connector<BetterSqlite3Database>>;

export interface DocumentIndex {
  id: number;
  name: string;
  indexedPropertyPath: string;
  description?: string;
  documentCount?: number;
}

export interface DocumentWithData {
  id: number;
  data: any;
}

export interface DocumentForIndexing {
  id: number;
  textContent: string;
}

export interface EmbeddingEntry {
  documentId: number;
  indexId: number;
  vector: number[] | Float32Array;
}

export class DatabaseService {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  // Document operations
  async addDocument(data: any): Promise<number> {
    const result = await this.db.sql`
      INSERT INTO documents (data) VALUES (jsonb(${JSON.stringify(data)}))
      RETURNING id
    `;

    if (!result || !result.rows.length) {
      throw new Error("Failed to insert document");
    }

    return +result.rows[0].id;
  }

  async addEmbeddings(entries: EmbeddingEntry[]): Promise<number> {
    let insertedCount = 0;

    // Process each embedding entry
    for (const entry of entries) {
      await this.db.sql`
        INSERT INTO embeddings (document_id, index_id, vector)
        VALUES (
          CAST(${entry.documentId} as integer),
          CAST(${entry.indexId} as integer),
          ${new Float32Array(entry.vector) as unknown as Primitive}
        )
      `;

      insertedCount++;
    }

    return insertedCount;
  }

  async searchDocumentsByVector(
    vector: number[] | Float32Array,
    indexName: string,
    limit: number = 10
  ): Promise<DocumentWithData[]> {
    // First get the index ID
    const indexQuery = await this.db.sql`
      SELECT id FROM indices WHERE name = ${indexName} LIMIT 1
    `;

    if (!indexQuery.rows.length) {
      throw new Error(`Index "${indexName}" not found`);
    }

    const indexId = indexQuery.rows[0].id;

    // Search for documents by vector similarity
    const documents = await this.db.sql`
      SELECT d.id, JSON(d.data) as data
      FROM documents d
      JOIN embeddings e ON d.id = e.document_id
      WHERE e.index_id = ${indexId}
      ORDER BY vec_distance_cosine(e.vector, ${
        new Float32Array(vector) as unknown as Primitive
      }) ASC
      LIMIT ${limit}
    `;

    // Parse the document data
    return documents.rows.map(row => ({
      id: +row.id,
      data: JSON.parse(String(row.data))
    }));
  }

  // Index operations
  async createIndex(name: string, indexedPropertyPath: string, description?: string): Promise<DocumentIndex> {
    // Validate the property path by making sure it's a valid JSON path
    try {
      await this.db.sql`SELECT json_extract('{"test": "value"}', ${indexedPropertyPath})`;
    } catch (error) {
      throw new Error(`Invalid property path: ${indexedPropertyPath}`);
    }

    const result = await this.db.sql`
      INSERT INTO indices (name, indexed_property_path, description)
      VALUES (${name}, ${indexedPropertyPath}, ${description || null})
      RETURNING
        id,
        name,
        indexed_property_path as indexedPropertyPath,
        description
    `;

    if (!result.rows.length) {
      throw new Error(`Failed to create index "${name}"`);
    }

    return result.rows[0] as unknown as DocumentIndex;
  }

  async listIndices(): Promise<DocumentIndex[]> {
    const result = await this.db.sql`
      SELECT
        id,
        name,
        indexed_property_path as indexedPropertyPath,
        description,
        (SELECT COUNT(*) FROM embeddings WHERE index_id = indices.id) as documentCount
      FROM indices
      ORDER BY name
    `;

    return result.rows as unknown as DocumentIndex[];
  }

  async getIndexByName(name: string): Promise<DocumentIndex | null> {
    const result = await this.db.sql`
      SELECT
        id,
        name,
        indexed_property_path as indexedPropertyPath,
        description
      FROM indices
      WHERE name = ${name}
      LIMIT 1
    `;

    return result.rows.length ? (result.rows[0] as unknown as DocumentIndex) : null;
  }

  async getDocumentsForIndexing(
    indexName: string,
    batchSize: number = 100
  ): Promise<DocumentForIndexing[]> {
    // Get the index
    const index = await this.getIndexByName(indexName);
    if (!index) {
      throw new Error(`Index "${indexName}" not found`);
    }

    // Get documents that don't have embeddings for this index
    const query = await this.db.sql`
      SELECT
        d.id,
        JSON_EXTRACT(d.data, ${index.indexedPropertyPath}) as textContent
      FROM documents d
      WHERE
        NOT EXISTS (
          SELECT 1 FROM embeddings e
          WHERE e.document_id = d.id AND e.index_id = ${index.id}
        )
        AND JSON_EXTRACT(d.data, ${index.indexedPropertyPath}) IS NOT NULL
        AND JSON_TYPE(d.data, ${index.indexedPropertyPath}) = 'text'
      LIMIT ${batchSize}
    `;

    return query.rows as unknown as DocumentForIndexing[];
  }

  async extractTextByPropertyPath(documentId: number, propertyPath: string): Promise<string | null> {
    const result = await this.db.sql`
      SELECT JSON_EXTRACT(data, ${propertyPath}) as textContent
      FROM documents
      WHERE id = ${documentId}
    `;

    return result.rows.length ? String(result.rows[0].textContent) : null;
  }
}

export function createDatabaseService(db: Db): DatabaseService {
  return new DatabaseService(db);
}
