/**
 * The artifacts the drain writes once its loop is over - review-base (Main's HEAD when the drain
 * started), review.md (the reviewers' findings) and summary.md (the merged report) - and the skip
 * protocol that crosses the review -> summary boundary. The names, the line a node writes when it
 * has nothing to report, and the one reader of that line live here, so producer and consumer cannot
 * spell a sentinel differently: an empty drain paying an agent to summarise a non-review was exactly
 * that drift.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitOrThrow } from "./git.ts";
import { nodeLine } from "./node-outcomes.ts";

/** The drain-end artifacts, relative to ARTIFACTS_DIR. */
export const REVIEW_BASE_REL = "review-base";
export const REVIEW_MD_REL = "review.md";
export const SUMMARY_MD_REL = "summary.md";

/**
 * The two openers of the skip protocol. A node with nothing to report writes one instead of spending
 * an agent, and the consumer reads it back through reviewSkipReason; `review error:` is a skip with a
 * reason, so a review that failed is never summarised as if it held findings.
 */
const SKIP = "skip:";
const REVIEW_ERROR = "review error:";

/** What a node with nothing to do writes: the skip line, ended like every node token (nodeLine). */
export function skipLine(reason: string): string {
  return nodeLine(`${SKIP} ${reason}`);
}

/** A review failure without the line ending: one axis' section body inside review.md. */
export function reviewErrorText(detail: string): string {
  return `${REVIEW_ERROR} ${detail}`;
}

/** review.ts's own failure line: the range could not be read at all. The consumer reads it as a skip. */
export function reviewErrorLine(detail: string): string {
  return nodeLine(reviewErrorText(detail));
}

/**
 * The one reader of review.md's skip protocol: the reason line when the review holds no report
 * (skipped, or failed), null when it is findings the summary node may merge. Empty content is null
 * too - summary.ts owns that case, because review.ts cannot produce it.
 */
export function reviewSkipReason(reviewMd: string): string | null {
  const first = reviewMd.trim().split("\n")[0] ?? "";
  return first.startsWith(SKIP) || first.startsWith(REVIEW_ERROR) ? first : null;
}

/** One drain-end artifact ends with exactly one newline, the convention every node token follows. */
export function writeArtifact(file: string, body: string): void {
  writeFileSync(file, body.endsWith("\n") ? body : nodeLine(body));
}

/** review-base read back: the SHA, or the skip line the node writes instead of reviewing. */
type ReviewBaseRead = { base: string } | { skip: string };

/** The base both drain-end nodes need, so the artifact's shape (one SHA) is read in one place. */
export function readReviewBase(artifactsDir: string): ReviewBaseRead {
  const baseFile = join(artifactsDir, REVIEW_BASE_REL);
  if (!existsSync(baseFile)) return { skip: skipLine("no review-base") };
  const base = readFileSync(baseFile, "utf8").trim();
  if (!base) return { skip: skipLine("empty review-base") };
  return { base };
}

/**
 * Writes Main's HEAD sha for the whole drain to read. rematch.ts calls this at the end of its pass -
 * before the loop, so the read-only nodes report the range the drain started from.
 */
export async function writeReviewBase(target: string, artifactsDir: string): Promise<string> {
  mkdirSync(artifactsDir, { recursive: true });
  const sha = await gitOrThrow(target, ["rev-parse", "HEAD"]);
  writeArtifact(join(artifactsDir, REVIEW_BASE_REL), sha);
  return sha;
}
