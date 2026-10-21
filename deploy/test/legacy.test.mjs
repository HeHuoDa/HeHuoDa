import assert from "node:assert/strict";
import { test } from "node:test";
import legacy from "../nginx/legacy.mjs";

test("legacy details use the path ID and preserve repeated unrelated values", () => {
  assert.equal(
    legacy.target(
      "/home/competitions/example/",
      "id=other&%69d=third&stage=a&stage=b",
    ),
    "/#/pages/home/competition?id=example&stage=a&stage=b",
  );
  assert.equal(
    legacy.target("/teams/team-1/", "id=x"),
    "/#/pages/teams/detail?id=team-1",
  );
});

test("legacy profile sections override all query aliases", () => {
  assert.equal(
    legacy.target(
      "/my/teams/",
      "section=applications&%73ection=other&next=%2Fhome",
    ),
    "/#/pages/profile/index?section=teams&next=%2Fhome",
  );
  assert.equal(
    legacy.target("/my/applications", ""),
    "/#/pages/profile/index?section=applications",
  );
});

test("legacy static routes accept trailing slashes and preserve encoding", () => {
  assert.equal(
    legacy.target("/teams/new/", "next=%2Fhome&tag=a&tag=b"),
    "/#/pages/teams/new?next=%2Fhome&tag=a&tag=b",
  );
  assert.equal(legacy.target("/home/", ""), "/#/pages/index/index");
  assert.equal(legacy.target("/missing", ""), null);
});
