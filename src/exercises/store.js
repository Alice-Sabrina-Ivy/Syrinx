// store.js — the lessons' saved results in Dexie (`exerciseResults`, src/db.js). Every
// call swallows storage errors (site data blocked): a lesson still runs, it just isn't
// remembered. Pass db.exerciseResults (or anything with Dexie's table API) as `table`.

import { resultRow } from "./results.js";

/** Add a row; resolves to its id, or null. */
export async function saveResult(table, fields) {
  try {
    return await table.add(resultRow(fields));
  } catch (err) {
    console.error("Exercises: could not save the result", err);
    return null;
  }
}

/** Change a saved row (the feel answer, the end time). */
export async function updateResult(table, id, patch) {
  if (id == null) return false;
  try {
    return (await table.update(id, patch)) > 0;
  } catch (err) {
    console.error("Exercises: could not update the result", err);
    return false;
  }
}

/** { [exerciseId]: the newest row's startedAt } over every saved row. */
export async function lastDoneByLesson(table) {
  try {
    const out = {};
    await table.orderBy("startedAt").each((row) => {
      if (typeof row.exerciseId === "string") out[row.exerciseId] = row.startedAt;
    });
    return out;
  } catch {
    return {};
  }
}

/** The newest `n` rows of one lesson, newest first, other than `exceptId`. */
export async function recentResults(table, exerciseId, n = 5, exceptId = null) {
  try {
    const rows = await table.where("exerciseId").equals(exerciseId).toArray();
    return rows
      .filter((r) => r.id !== exceptId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, n);
  } catch {
    return [];
  }
}
