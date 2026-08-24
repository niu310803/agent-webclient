import { readHostRequiredSkills } from "@/features/composer/components/HostRequiredSkillsContext";

describe("readHostRequiredSkills", () => {
  it("reads and case-insensitively deduplicates repeated host skill params", () => {
    const params = new URLSearchParams();
    params.append("mustUseSkill", "poster-studio");
    params.append("mustUseSkill", "poster-studio");
    params.append("mustUseSkill", "../unsafe");
    expect(readHostRequiredSkills("webOperator", params)).toEqual({
      agentKey: "webOperator",
      skills: ["poster-studio"],
    });
  });

  it("ignores host skills without a scoped Copilot agent", () => {
    expect(
      readHostRequiredSkills("", new URLSearchParams("mustUseSkill=poster-studio")),
    ).toEqual({ agentKey: "", skills: [] });
  });
});
