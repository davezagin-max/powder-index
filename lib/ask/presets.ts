/**
 * Preset questions and their bundled answers. In demo mode these are replayed in the
 * browser with no server call: the SQL comes from the fixture and DuckDB-WASM runs it
 * for real against the published data.
 */
import fixtureFile from "@/fixtures/ask.json";
import presetFile from "@/fixtures/presets.json";
import type { Fixture, FixtureStore } from "@/lib/demo";
import type { AskData } from "./schema";

export const ASK_FIXTURES = fixtureFile as FixtureStore<AskData>;

export interface Preset {
  id: string;
  question: string;
}

export const PRESETS: Preset[] = presetFile.map((preset) => ({
  id: preset.body.demoId,
  question: preset.body.question,
}));

/**
 * True while any bundled answer is a hand-written sample rather than a recorded model
 * run. Every label that describes demo output keys off this flag or the fixture's own.
 */
export const ASK_HAS_PLACEHOLDERS = Object.values(ASK_FIXTURES).some((fixture: Fixture) => fixture.placeholder);
