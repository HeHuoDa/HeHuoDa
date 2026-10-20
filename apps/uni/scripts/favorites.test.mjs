import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinia } from "pinia";
import { useSessionStore } from "../src/stores/session.ts";

test("收藏按比赛去重、最近优先，三处消费者共享状态且统一重置清空", () => {
  const pinia = createPinia();
  const detail = useSessionStore(pinia);
  const list = useSessionStore(pinia);
  const profile = useSessionStore(pinia);
  detail.addFavorite("a");
  detail.addFavorite("a");
  assert.equal(profile.favoriteCount, 1);
  list.addFavorite("b");
  assert.deepEqual(
    list.favorites.map((item) => item.id),
    ["b", "a"],
  );
  list.removeFavorite("a");
  assert.equal(detail.isFavorite("a"), false);
  detail.addFavorite("a");
  assert.deepEqual(
    list.favorites.map((item) => item.id),
    ["a", "b"],
  );
  assert.equal(profile.favoriteCount, 2);
  assert.equal(useSessionStore(createPinia()).favoriteCount, 0);
  profile.reset();
  assert.equal(list.favoriteCount, 0);
  assert.equal(detail.isFavorite("b"), false);
});
