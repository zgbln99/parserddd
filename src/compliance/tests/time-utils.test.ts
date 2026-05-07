import { describe, expect, it } from "vitest";
import {
  durationMinutes,
  findGaps,
  intersect,
  overlaps,
  sortIntervals,
  sumMinutes,
} from "../calculations/time.js";
import { localDateKey, tzOffsetMinutes } from "../calculations/time-zones.js";

describe("time utilities", () => {
  it("computes duration in whole minutes", () => {
    expect(
      durationMinutes({
        start: new Date("2026-01-01T00:00:00Z"),
        end: new Date("2026-01-01T01:30:00Z"),
      }),
    ).toBe(90);
  });

  it("returns 0 for inverted ranges", () => {
    expect(
      durationMinutes({
        start: new Date("2026-01-01T01:00:00Z"),
        end: new Date("2026-01-01T00:00:00Z"),
      }),
    ).toBe(0);
  });

  it("detects overlaps with half-open semantics", () => {
    const a = { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-01-01T01:00:00Z") };
    const b = { start: new Date("2026-01-01T01:00:00Z"), end: new Date("2026-01-01T02:00:00Z") };
    expect(overlaps(a, b)).toBe(false);
    expect(intersect(a, b)).toBeNull();
  });

  it("finds gaps inside a range", () => {
    const gaps = findGaps(
      { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-01-01T10:00:00Z") },
      [
        { start: new Date("2026-01-01T02:00:00Z"), end: new Date("2026-01-01T04:00:00Z") },
        { start: new Date("2026-01-01T05:00:00Z"), end: new Date("2026-01-01T08:00:00Z") },
      ],
    );
    expect(gaps).toHaveLength(3);
    expect(durationMinutes(gaps[0]!)).toBe(120);
    expect(durationMinutes(gaps[1]!)).toBe(60);
    expect(durationMinutes(gaps[2]!)).toBe(120);
  });

  it("sums minutes across intervals", () => {
    expect(
      sumMinutes([
        { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-01-01T00:30:00Z") },
        { start: new Date("2026-01-01T01:00:00Z"), end: new Date("2026-01-01T02:30:00Z") },
      ]),
    ).toBe(120);
  });

  it("sorts intervals stably by start", () => {
    const xs = [
      { start: new Date("2026-01-01T01:00:00Z"), end: new Date("2026-01-01T02:00:00Z") },
      { start: new Date("2026-01-01T00:00:00Z"), end: new Date("2026-01-01T01:00:00Z") },
    ];
    const sorted = sortIntervals(xs);
    expect(sorted[0]?.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("time zones (DST safety)", () => {
  it("renders local date keys for Europe/Berlin across DST boundary", () => {
    // 2026-03-29 02:00 local DST → +0100 before, +0200 after.
    expect(localDateKey(new Date("2026-03-29T00:30:00Z"), "Europe/Berlin")).toBe("2026-03-29");
    expect(localDateKey(new Date("2026-03-29T01:30:00Z"), "Europe/Berlin")).toBe("2026-03-29");
  });

  it("computes offset minutes correctly across DST", () => {
    expect(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), "Europe/Berlin")).toBe(60);
    expect(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Europe/Berlin")).toBe(120);
  });
});
