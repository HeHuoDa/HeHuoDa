<script setup lang="ts">
import { useRoute } from "vue-router";
import AppIcon from "../components/AppIcon.vue";
import type { AppIconName } from "../components/app-icons";
import ProjectLogo from "../components/ProjectLogo.vue";
import type { NavigationSection } from "../router";

const route = useRoute();
const navigation: {
  section: NavigationSection;
  label: string;
  mobile?: string;
  to: string;
  icon: AppIconName;
}[] = [
  {
    section: "home",
    label: "首页",
    mobile: "首页",
    to: "/home",
    icon: "home",
  },
  {
    section: "teams",
    label: "找队友",
    mobile: "找队友",
    to: "/teams",
    icon: "users",
  },
  {
    section: "favorites",
    label: "我的收藏",
    to: "/my/favorites",
    icon: "star",
  },
  {
    section: "notifications",
    label: "站内通知",
    to: "/notifications",
    icon: "bell",
  },
  {
    section: "profile",
    label: "我的",
    mobile: "我的",
    to: "/profile",
    icon: "user",
  },
];
function current(section: NavigationSection, mobile = false) {
  return (
    route.meta.navigation === section ||
    (mobile &&
      section === "profile" &&
      ["favorites", "notifications"].includes(route.meta.navigation ?? ""))
  );
}
</script>

<template>
  <div class="student-shell">
    <a href="#student-content" class="skip-link hhr-button">跳到正文</a>
    <aside class="student-sidebar">
      <RouterLink to="/home" class="brand-link">
        <ProjectLogo />
        <span
          ><strong class="font-serif text-xl">禾伙搭</strong
          ><small class="block text-xs text-muted"
            >一起成长，各有所长</small
          ></span
        >
      </RouterLink>
      <p class="my-7 rounded-control border border-line p-3 text-xs text-muted">
        四川农业大学 · 校园比赛与项目组队
      </p>
      <nav aria-label="学生端主导航" class="grid gap-2">
        <RouterLink
          v-for="item in navigation"
          :key="item.section"
          :to="item.to"
          class="student-nav-link"
          :class="{ 'is-current': current(item.section) }"
          :aria-current="current(item.section) ? 'page' : undefined"
        >
          <AppIcon :name="item.icon" class="size-[22px]" /><span>{{
            item.label
          }}</span>
        </RouterLink>
      </nav>
      <p class="mt-auto pt-8 text-xs leading-6 text-muted">
        从一颗种子开始，<br />和伙伴一起把想法变成可能。
      </p>
    </aside>
    <div class="student-body">
      <header class="student-topbar">
        <RouterLink to="/home" class="brand-link topbar-brand">
          <ProjectLogo />
          <span class="topbar-brand-name">禾伙搭</span>
        </RouterLink>
        <nav aria-label="顶栏快捷入口" class="topbar-actions">
          <RouterLink
            to="/notifications"
            aria-label="站内通知"
            title="站内通知"
            class="topbar-icon-link"
          >
            <AppIcon name="bell" class="size-6" />
          </RouterLink>
          <RouterLink
            to="/profile"
            aria-label="个人中心"
            title="个人中心"
            class="topbar-icon-link"
          >
            <AppIcon name="user" class="size-6" />
          </RouterLink>
        </nav>
      </header>
      <main id="student-content" tabindex="-1" class="student-content">
        <RouterView />
      </main>
    </div>
    <nav aria-label="移动端主导航" class="student-bottom-nav">
      <template v-for="item in navigation" :key="item.section">
        <RouterLink
          v-if="item.mobile"
          :to="item.to"
          :class="{ 'is-current': current(item.section, true) }"
          :aria-current="current(item.section, true) ? 'page' : undefined"
        >
          <AppIcon :name="item.icon" class="size-[22px]" /><span>{{
            item.mobile
          }}</span>
        </RouterLink>
      </template>
    </nav>
  </div>
</template>
