import getDb from "~/utils/getDb";

export default defineEventHandler(async (event) => {
  try {
    const db = await getDb();
    const version = await db.sql<{
      rows: Array<{
        vec_version: string;
      }>;
    }>`select vec_version() as vec_version;`;
    if (version.rows.length !== 1) {
      throw new Error("db query failed");
    }
    const ai = await useAiContext();
    return {
      status: "ok",
      message: "The server is healthy",
    };
  } catch (e) {
    throw createError({
      statusCode: 500,
      message: "initialization failed",
      cause: e,
    });
  }
});
