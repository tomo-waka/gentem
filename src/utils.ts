import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as nodePath from "node:path";
import { normalizeWeight } from "./common/weightedItemFeeder.js";
import {
  DEFAULT_TEMPLATE_WEIGHT,
  OutputTypes,
  TemplateModes,
} from "./consts.js";
import type {
  OutputOptions,
  OutputType,
  ProgramOptions,
  TemplateMode,
  TemplateOptions,
} from "./types.js"; // region type guards

// region type guards

export function isString(value: unknown) {
  return typeof value === "string";
}

export function isNonNullObject(
  value: unknown,
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return true;
}

export function isTemplateMode(value: unknown): value is TemplateMode {
  if (typeof value !== "string") {
    return false;
  }
  const candidates: readonly string[] = TemplateModes;
  return candidates.includes(value);
}

export function isOutputType(value: unknown): value is OutputType {
  if (typeof value !== "string") {
    return false;
  }
  const candidates: readonly string[] = OutputTypes;
  return candidates.includes(value);
}

// endregion

// region parsers

export function parseString(value: unknown): string | undefined {
  if (!isString(value)) {
    return undefined;
  }
  return value;
}

export function parseNonNaNInteger(value: unknown): number | undefined {
  if (Number.isInteger(value)) {
    return value as number;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const numValue = Number.parseInt(value);
  if (Number.isNaN(numValue)) {
    return undefined;
  }
  return numValue;
}

export function parseNonNaNFloat(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return undefined;
    }
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const numValue = Number.parseFloat(value);
  if (Number.isNaN(numValue)) {
    return undefined;
  }
  return numValue;
}

export function parseDate(value: unknown): Date | undefined {
  if (!isString(value)) {
    return undefined;
  }
  const dateNumber = Date.parse(value);
  if (Number.isNaN(dateNumber)) {
    return undefined;
  }
  return new Date(dateNumber);
}

export function parseAndResolveFilePath(
  value: unknown,
  basePath: string,
): string | undefined {
  if (!isString(value)) {
    return undefined;
  }
  if (nodePath.isAbsolute(value)) {
    return value;
  } else {
    return nodePath.resolve(basePath, value);
  }
}

export async function tryReadFile(path: string): Promise<string> {
  try {
    await fsPromises.access(path, fs.constants.R_OK);
  } catch (error) {
    console.log(error);
    throw new Error(`cannot access the file. ${path}`);
  }
  let contentString: string | undefined;
  try {
    contentString = await fsPromises.readFile(path, {
      encoding: "utf8",
    });
  } catch (error) {
    console.log(error);
    throw new Error(`failed to read the file. ${path}`);
  }
  return contentString;
}

export function normalizeProgramOptions(
  possibleProgramOptions: unknown,
  basePath: string,
): ProgramOptions | undefined {
  if (!isNonNullObject(possibleProgramOptions)) {
    return undefined;
  }

  let from = parseDate(possibleProgramOptions["from"]);
  let to = parseDate(possibleProgramOptions["to"]);
  if (from === undefined || to === undefined) {
    const now = Date.now();
    from = new Date(now - 1000 * 60 * 60 * 24);
    to = new Date(now);
  }

  let count = parseNonNaNInteger(possibleProgramOptions["count"]);
  if (count === undefined) {
    count = 0;
  }

  let out = normalizeOutputOptions(possibleProgramOptions["out"], basePath);
  if (out === undefined) {
    console.error(`Invalid out option. (${out})`);
    return undefined;
  }

  const debug = possibleProgramOptions["debug"] === true;

  let templateOptionsArray: TemplateOptions[] | undefined;
  const possibleTemplateOptionsArray = possibleProgramOptions["templates"];
  if (Array.isArray(possibleTemplateOptionsArray)) {
    templateOptionsArray =
      possibleTemplateOptionsArray.flatMap<TemplateOptions>(
        (possibleTemplateOptions: unknown) => {
          if (!isNonNullObject(possibleTemplateOptions)) {
            return [];
          }

          const possiblePath = possibleTemplateOptions["path"];
          const path = parseString(possiblePath);
          if (path === undefined) {
            console.error(`invalid file path.(${possiblePath})`);
            return [];
          }
          const resolvedFilePath = parseAndResolveFilePath(path, basePath);
          if (resolvedFilePath === undefined) {
            console.error(`failed to resolve the file path.(${path})`);
            return [];
          }

          const possibleMode = possibleTemplateOptions["mode"];
          let mode: TemplateMode;
          if (isTemplateMode(possibleMode)) {
            mode = possibleMode;
          } else {
            mode = determineTemplateModeByFile(resolvedFilePath);
          }

          const weight =
            parseNonNaNFloat(possibleTemplateOptions["weight"]) ??
            DEFAULT_TEMPLATE_WEIGHT;
          const normalizedWeight = normalizeWeight(weight);
          return {
            mode: mode,
            path: resolvedFilePath,
            weight: normalizedWeight,
          };
        },
      );
  }
  if (templateOptionsArray === undefined || templateOptionsArray.length === 0) {
    console.error("no effective template specified.");
    return undefined;
  }

  return {
    debug,
    from,
    to,
    count,
    out,
    templates: templateOptionsArray,
  };
}

function normalizeOutputOptions(
  possibleOutputOptions: unknown,
  basePath: string,
): OutputOptions | undefined {
  if (typeof possibleOutputOptions === "string") {
    // shorthand
    return {
      type: "file",
      path: possibleOutputOptions,
    };
  }

  if (!isNonNullObject(possibleOutputOptions)) {
    return undefined;
  }

  const possibleType = parseString(possibleOutputOptions["type"]);
  if (!isOutputType(possibleType)) {
    console.error(`invalid output type.(${possibleType})`);
    return undefined;
  }
  const possiblePath = parseAndResolveFilePath(
    possibleOutputOptions["path"],
    basePath,
  );
  if (possiblePath === undefined) {
    console.error(`output path must be specified.(${possiblePath})`);
    return undefined;
  }

  const possibleSize = parseString(possibleOutputOptions["size"]);
  if (possibleSize === undefined) {
    return {
      type: possibleType,
      path: possiblePath,
    };
  } else {
    return {
      type: possibleType,
      path: possiblePath,
      size: possibleSize,
    };
  }
}

export function determineTemplateModeByFile(filePath: string): TemplateMode {
  return nodePath.extname(filePath) === ".json" ? "json" : "text";
}

// endregion

// region misc

export function pickFirst<T>(input: T | T[] | undefined): T | undefined {
  if (input === undefined) {
    return undefined;
  } else if (Array.isArray(input)) {
    return input[0];
  } else {
    return input;
  }
}

export function pickMany<T>(input: T | T[] | undefined): T[] {
  if (input === undefined) {
    return [];
  } else if (Array.isArray(input)) {
    return input;
  } else {
    return [input];
  }
}

// endregion

// region misc

export function assertNever(x: never): never {
  throw new Error(`Unexpected object: ${x}`);
}

// endregion