import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = resolve(import.meta.dirname, "../src");

interface Violation {
  file: string;
  imported: string;
  rule: string;
}

function listFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listFiles(full));
    } else if (extname(full) === ".ts") {
      files.push(full);
    }
  }
  return files;
}

// Matches relative import/export specifiers, including `import type` and
// `export ... from`, but not package specifiers like "fastify".
function importsOf(file: string): string[] {
  const content = readFileSync(file, "utf8");
  const matches = [
    ...content.matchAll(/from\s+["'](\.[^"']+)["']/g),
    ...content.matchAll(/import\s+["'](\.[^"']+)["']/g),
  ];
  return matches.map((m) => resolve(dirname(file), m[1] as string));
}

// Import specifiers from the "fastify" package itself, e.g. `FastifyInstance`
// out of `import type { FastifyInstance } from "fastify"`.
function fastifyImportSpecifiers(file: string): string[] {
  const content = readFileSync(file, "utf8");
  const specifiers: string[] = [];
  for (const match of content.matchAll(
    /import\s+type\s*\{([^}]+)\}\s*from\s*["']fastify["']/g,
  )) {
    specifiers.push(
      ...(match[1] as string)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return specifiers;
}

function hasFastifyPluginImport(file: string): boolean {
  return /from\s+["']fastify-plugin["']/.test(readFileSync(file, "utf8"));
}

function relativeToSrc(path: string): string {
  return relative(SRC_ROOT, path).replaceAll("\\", "/");
}

// Layer of a file under src/, or null for root files (app.ts, lib/, db/,
// config/) that this test does not constrain.
function layerOf(relPath: string): { layer: string; slice: string } | null {
  const [layer, slice] = relPath.split("/");
  if (
    layer === "features" ||
    layer === "modules" ||
    layer === "plugins" ||
    layer === "http"
  ) {
    return { layer, slice: slice ?? "" };
  }
  return null;
}

const allowedFastifySpecifiers = new Set([
  "FastifyBaseLogger",
  "FastifyInstance",
  "FastifyPluginAsync",
]);

// Pending task 14 deletes credential-throttle's policy import from
// lib/retention.ts, which is the one lib file allowed to reach into
// modules/ today.
const ruleSixAllowlist = new Set([
  "lib/retention.ts", // TODO(task 14): drop once retention owns its own cutoff policy
]);

describe("architecture: dependency direction between layers", () => {
  const files = listFiles(SRC_ROOT);
  const violations: Violation[] = [];
  const scannedByLayer = new Set<string>();

  for (const file of files) {
    const relPath = relativeToSrc(file);
    const info = layerOf(relPath);

    if (info) {
      scannedByLayer.add(info.layer);
    } else {
      const base = relPath.split("/")[0];
      if (base === "lib" || base === "db" || base === "config") {
        scannedByLayer.add(base);
      }
    }

    for (const imported of importsOf(file)) {
      if (!imported.startsWith(SRC_ROOT)) continue;
      const importedRel = relativeToSrc(imported);
      const importedInfo = layerOf(importedRel);

      if (info) {
        if (info.layer === "features" && importedInfo?.layer === "features") {
          if (importedInfo.slice !== info.slice) {
            violations.push({
              file: relPath,
              imported: importedRel,
              rule: "a feature must not import another feature",
            });
          }
        }

        if (info.layer === "modules") {
          if (importedInfo?.layer === "modules") {
            if (importedInfo.slice !== info.slice) {
              violations.push({
                file: relPath,
                imported: importedRel,
                rule: "a module must not import another module",
              });
            }
          } else if (
            importedInfo?.layer === "features" ||
            importedInfo?.layer === "http"
          ) {
            violations.push({
              file: relPath,
              imported: importedRel,
              rule: `a module must not import ${importedInfo.layer}`,
            });
          }
        }

        if (info.layer === "plugins") {
          if (
            importedInfo?.layer === "modules" ||
            importedInfo?.layer === "features" ||
            importedInfo?.layer === "http"
          ) {
            violations.push({
              file: relPath,
              imported: importedRel,
              rule: `plugins must not import ${importedInfo.layer}`,
            });
          }
        }

        if (info.layer === "http") {
          if (importedInfo?.layer === "features") {
            violations.push({
              file: relPath,
              imported: importedRel,
              rule: "http must not import features",
            });
          }
        }
      } else {
        const base = relPath.split("/")[0];
        const isBaseLayer =
          base === "lib" || base === "db" || base === "config";
        if (isBaseLayer && importedInfo && !ruleSixAllowlist.has(relPath)) {
          violations.push({
            file: relPath,
            imported: importedRel,
            rule: `${base} must not import from ${importedInfo.layer}`,
          });
        }
      }
    }

    if (relPath.startsWith("modules/")) {
      const isIndex = relPath.endsWith("/index.ts");
      for (const specifier of fastifyImportSpecifiers(file)) {
        if (allowedFastifySpecifiers.has(specifier)) continue;
        violations.push({
          file: relPath,
          imported: `fastify:${specifier}`,
          rule: "a module file may only import FastifyBaseLogger, FastifyInstance or FastifyPluginAsync types from fastify",
        });
      }
      if (!isIndex && hasFastifyPluginImport(file)) {
        violations.push({
          file: relPath,
          imported: "fastify-plugin",
          rule: "only a module's index.ts may import fastify-plugin",
        });
      }
    }
  }

  it("scanned at least one file per layer", () => {
    expect(files.length).toBeGreaterThan(0);
    for (const layer of ["features", "modules", "plugins", "http"]) {
      expect(scannedByLayer).toContain(layer);
    }
  });

  it("has no dependency direction violations", () => {
    const messages = violations.map(
      (v) => `${v.file} imports ${v.imported} (${v.rule})`,
    );
    expect(messages).toEqual([]);
  });
});
