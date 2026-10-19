import { describe, expect, it } from "vitest";
import { parseReportLink } from "@/lib/reports";

describe("parseReportLink", () => {
  it("reads report links, with or without a fight", () => {
    expect(parseReportLink("https://www.warcraftlogs.com/reports/aB3xQ9mK2LpR7tZw")).toEqual({ code: "aB3xQ9mK2LpR7tZw", fightId: null });
    expect(parseReportLink(" https://www.warcraftlogs.com/reports/aB3xQ9mK2LpR7tZw#fight=12&type=damage-done ")).toEqual({
      code: "aB3xQ9mK2LpR7tZw",
      fightId: 12,
    });
    expect(parseReportLink("https://www.warcraftlogs.com/reports/aB3xQ9mK2LpR7tZw?fight=3")?.fightId).toBe(3);
    expect(parseReportLink("aB3xQ9mK2LpR7tZw")?.code).toBe("aB3xQ9mK2LpR7tZw");
  });

  it("rejects anything else", () => {
    expect(parseReportLink("https://www.warcraftlogs.com/character/us/stormrage/leafy")).toBeNull();
    expect(parseReportLink("hello")).toBeNull();
  });
});
